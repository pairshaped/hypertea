import type { ProgramMsg, ProgramSubscription } from "./program.js";

export type WebMCPValue =
  | string
  | number
  | boolean
  // null is allowed at the JSON protocol boundary, not as runtime state.
  | null
  | ReadonlyArray<WebMCPValue>
  | Readonly<{ [key: string]: WebMCPValue; }>;

declare const invocationBrand: unique symbol;
export type WebMCPInvocation = string & { readonly [invocationBrand]: true; };

export type WebMCPCompletion = Readonly<{
  type: "webmcp.complete";
  invocation: WebMCPInvocation;
  result: WebMCPValue;
}>;

export class WebMCPInvocationError extends Error {
  constructor(readonly outcome: "cancelled-before-dispatch" | "unknown") {
    super(outcome === "unknown"
      ? "WebMCP stopped waiting after dispatch; the application outcome is unknown"
      : "WebMCP invocation cancelled before dispatch");
    this.name = "WebMCPInvocationError";
  }
}

export type WebMCPToolMetadata = Readonly<{
  name: string;
  description: string;
  title?: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations?: Readonly<{
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
    debugging?: boolean;
  }>;
}>;

export type WebMCPTool<Msg extends ProgramMsg> = WebMCPToolMetadata & Readonly<{
  toMessage: (input: unknown, invocation: WebMCPInvocation) => Msg;
}>;

export type WebMCPRegisteredTool = WebMCPToolMetadata & Readonly<{
  execute: (input: unknown, options?: Readonly<{ signal: AbortSignal; }>) => Promise<WebMCPValue>;
}>;

export type WebMCPAgent = Readonly<{
  version: 1;
  getTools: () => ReadonlyArray<WebMCPToolMetadata>;
  executeTool: (name: string, input: unknown, options?: Readonly<{ signal: AbortSignal; }>) => Promise<WebMCPValue>;
}>;

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Extend the browser's ambient Window interface.
  interface Window {
    hyperteaAgent?: WebMCPAgent;
  }
}

type AgentPublication = {
  readonly entries: Map<string, Readonly<{ tool: WebMCPRegisteredTool; metadata: string; }>>;
  readonly catalog: HTMLScriptElement;
  readonly agent: WebMCPAgent;
  definitions: string;
};

const agentPublications = new WeakMap<Document, AgentPublication>();

function refreshAgentCatalog(publication: AgentPublication): void {
  publication.definitions = `[${[...publication.entries.values()].map((entry) => entry.metadata).join(",")}]`;
  publication.catalog.textContent = `{"version":1,"global":"hyperteaAgent","tools":${publication.definitions}}`;
}

function exposeAgentTools(page: Document, tools: ReadonlyArray<WebMCPRegisteredTool>): () => void {
  const host = page.defaultView ?? undefined;
  if (host === undefined) throw new Error("Agent exposure requires a browser window");
  let publication = agentPublications.get(page);
  const names = new Set(publication?.entries.keys());
  // Validate and serialize before changing a shared publication. Failure in one
  // program must leave other programs' tools and catalog intact.
  const entries = tools.map((tool) => {
    if (names.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    names.add(tool.name);
    const { name, description, title, inputSchema, annotations } = tool;
    return { tool, metadata: JSON.stringify({ name, description, title, inputSchema, annotations }) };
  });
  if (publication === undefined) {
    if ("hyperteaAgent" in host || page.getElementById("hypertea-agent-tools") !== null) {
      throw new Error("Hypertea agent tools are already exposed in this document");
    }
    const catalog = page.createElement("script");
    catalog.id = "hypertea-agent-tools";
    catalog.type = "application/json";
    const created: AgentPublication = {
      entries: new Map(), catalog, definitions: "[]",
      agent: {
        version: 1,
        getTools: () => JSON.parse(created.definitions) as ReadonlyArray<WebMCPToolMetadata>,
        executeTool: async (name, input, options) => {
          const entry = created.entries.get(name);
          if (entry === undefined) throw new Error(`Unknown Hypertea tool: ${name}`);
          return entry.tool.execute(input, options);
        },
      },
    };
    host.hyperteaAgent = created.agent;
    page.head.append(catalog);
    agentPublications.set(page, created);
    publication = created;
  }
  for (const entry of entries) publication.entries.set(entry.tool.name, entry);
  refreshAgentCatalog(publication);
  const owned = publication;
  return () => {
    for (const tool of tools) owned.entries.delete(tool.name);
    refreshAgentCatalog(owned);
    if (owned.entries.size !== 0) return;
    if (host.hyperteaAgent === owned.agent) delete host.hyperteaAgent;
    owned.catalog.remove();
    agentPublications.delete(page);
  };
}

type ModelContext = Readonly<{
  registerTool: (tool: WebMCPRegisteredTool, options: Readonly<{ signal: AbortSignal; }>) => Promise<void>;
}>;

export function defineWebMCPTool<Input, Msg extends ProgramMsg>(
  declaration: WebMCPToolMetadata & Readonly<{
    parseInput: (input: unknown) => Input;
    toMessage: (input: Input, invocation: WebMCPInvocation) => Msg;
  }>,
): WebMCPTool<Msg> {
  const { parseInput, toMessage, ...metadata } = declaration;
  return {
    ...metadata,
    toMessage: (input, invocation) => toMessage(parseInput(input), invocation),
  };
}

export type WebMCPBridge<Msg extends ProgramMsg> = Readonly<{
  subscription: (tools: ReadonlyArray<WebMCPTool<Msg>>) => ProgramSubscription<Msg>;
  complete: (effect: WebMCPCompletion) => Promise<void>;
}>;

let nextBridge = 0;

export function createWebMCP<Msg extends ProgramMsg>(options: Readonly<{
  onRegistrationError: (error: unknown) => Msg;
}>): WebMCPBridge<Msg> {
  const key = `webmcp:${String(++nextBridge)}`;
  let nextInvocation = 0;
  let subscribed = false;
  const pending = new Map<WebMCPInvocation, Readonly<{
    complete: (result: WebMCPValue) => Promise<void>;
    cancel: () => void;
  }>>();

  return {
    subscription: (tools) => {
      // The tools reference is part of the subscription payload. A changed
      // declaration set must restart registration, even with the same key.
      const subscription = {
        key,
        tools,
        subscribe: (dispatch, context) => {
          const page = typeof document === "undefined" ? undefined : document;
          const modelContext = (page as (Document & { modelContext?: ModelContext; }) | undefined)?.modelContext;
          if (page === undefined) return () => {
            // Server-side use has no document to publish tools into.
          };
          if (subscribed) throw new Error("Create one WebMCP bridge per mounted program");
          subscribed = true;
          const registration = new AbortController();
          let active = true;
          let removeAgent: (() => void) | undefined;
          const unsubscribe = () => {
            if (!active) return;
            active = false;
            subscribed = false;
            registration.abort();
            removeAgent?.();
            for (const invocation of pending.values()) invocation.cancel();
          };
          const registered = tools.map((tool): WebMCPRegisteredTool => {
            const { toMessage, ...metadata } = tool;
            return {
              ...metadata,
              execute: async (input, execution) => {
                const signal = execution?.signal;
                if (!active || signal?.aborted === true) throw new WebMCPInvocationError("cancelled-before-dispatch");
                const invocation = `${key}:${String(++nextInvocation)}` as WebMCPInvocation;
                const message = toMessage(input, invocation);
                return new Promise<WebMCPValue>((resolve, reject) => {
                  let finished = false;
                  let completing = false;
                  const cleanup = () => {
                    finished = true;
                    pending.delete(invocation);
                    signal?.removeEventListener("abort", cancel);
                  };
                  const cancel = () => {
                    cleanup();
                    reject(new WebMCPInvocationError("unknown"));
                  };
                  pending.set(invocation, {
                    cancel,
                    complete: async (result) => {
                      if (completing) return;
                      completing = true;
                      await context.settle();
                      if (finished) return;
                      cleanup();
                      resolve(result);
                    },
                  });
                  signal?.addEventListener("abort", cancel, { once: true });
                  try {
                    dispatch(message);
                  } catch (error) {
                    cleanup();
                    reject(error instanceof Error ? error : new Error("WebMCP dispatch failed", { cause: error }));
                  }
                });
              },
            };
          });
          void (async () => {
            if (registered.length !== 0) removeAgent = exposeAgentTools(page, registered);
            await Promise.all(registered.map(async (tool) => {
              await modelContext?.registerTool(tool, { signal: registration.signal });
            }));
          })().catch((error: unknown) => {
            if (!active) return;
            unsubscribe();
            dispatch(options.onRegistrationError(error));
          });
          return unsubscribe;
        },
      } satisfies ProgramSubscription<Msg> & { tools: ReadonlyArray<WebMCPTool<Msg>>; };
      return subscription;
    },
    complete: async (effect) => {
      await pending.get(effect.invocation)?.complete(effect.result);
    },
  };
}
