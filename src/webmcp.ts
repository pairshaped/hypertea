import { legacyCallReply } from "./program.js"; // Y8 sports-q162
import type { EffectOrigin, ProgramMsg, ProgramSubscription } from "./program.js";

export type WebMCPValue =
  | string
  | number
  | boolean
  // null is allowed at the JSON protocol boundary, not as runtime state.
  | null
  | ReadonlyArray<WebMCPValue>
  | Readonly<{ [key: string]: WebMCPValue; }>;

declare const invocationBrand: unique symbol; // Y8 sports-q162
export type WebMCPInvocation = string & { readonly [invocationBrand]: true; }; // Y8 sports-q162

export type WebMCPCompletion = Readonly<{ // Y8 sports-q162
  type: "webmcp.complete"; // Y8 sports-q162
  invocation: WebMCPInvocation; // Y8 sports-q162
  result: WebMCPValue; // Y8 sports-q162
}>; // Y8 sports-q162

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

/** JSON input subset emitted by the message generator. */
export type WebMCPInputSchema =
  | Readonly<{ type: "string" | "number" | "boolean" | "null" }>
  | Readonly<{ const: string | number | boolean }>
  | Readonly<{ anyOf: ReadonlyArray<WebMCPInputSchema>; type?: "object" }>
  | Readonly<{ type: "array"; items: WebMCPInputSchema }>
  | Readonly<{ type: "object"; properties: Readonly<Record<string, WebMCPInputSchema>>; required: ReadonlyArray<string>; additionalProperties: false }>;

export type WebMCPTool<Msg extends ProgramMsg> = WebMCPToolMetadata & Readonly<{
  toMessage: (input: unknown, invocation: WebMCPInvocation) => Msg; // Y8 sports-q162
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

type AgentTool = Omit<WebMCPRegisteredTool, "execute"> & Readonly<{
  execute: (input: unknown, options?: Readonly<{ signal: AbortSignal }>, origin?: EffectOrigin) => Promise<WebMCPValue>;
}>;

type AgentPublication = {
  readonly entries: Map<string, Readonly<{ tool: AgentTool; metadata: string; }>>;
  readonly catalog: HTMLScriptElement;
  readonly agent: WebMCPAgent;
  definitions: string;
};

// Independently bundled programs still belong to the same document. Module-local
// WeakMaps would give the shell and feature bundles competing publications.
const publicationKey = Symbol.for("hypertea.webmcp.publication.v1");
const observersKey = Symbol.for("hypertea.webmcp.observers.v1");

export type WebMCPCallObserver = Readonly<{
  beforeDispatch?: (tool: WebMCPToolMetadata) => WebMCPValue | undefined;
  onStart?: (tool: WebMCPToolMetadata) => void;
}>;
type AgentDocument = Document & {
  [publicationKey]?: AgentPublication;
  [observersKey]?: Set<WebMCPCallObserver>;
};

/** Document-scoped admission and start notifications for native and fallback calls. */
export function observeWebMCPCalls(page: Document, observer: WebMCPCallObserver): () => void {
  const scope = page as AgentDocument;
  const observers = scope[observersKey] ?? new Set<WebMCPCallObserver>();
  scope[observersKey] = observers;
  observers.add(observer);
  return () => {
    observers.delete(observer);
    if (observers.size === 0 && scope[observersKey] === observers) Reflect.deleteProperty(scope, observersKey);
  };
}

function admitToolCall(page: Document, tool: WebMCPToolMetadata): WebMCPValue | undefined {
  const observers = [...((page as AgentDocument)[observersKey] ?? [])];
  for (const observer of observers) {
    const refusal = observer.beforeDispatch?.(tool);
    if (refusal !== undefined) return refusal;
  }
  for (const observer of observers) observer.onStart?.(tool);
  return undefined;
}

function refreshAgentCatalog(publication: AgentPublication): void {
  publication.definitions = `[${[...publication.entries.values()].map((entry) => entry.metadata).join(",")}]`;
  publication.catalog.textContent = `{"version":1,"global":"hyperteaAgent","tools":${publication.definitions}}`;
}

function exposeAgentTools(page: Document, tools: ReadonlyArray<AgentTool>): () => void {
  const host = page.defaultView ?? undefined;
  if (host === undefined) throw new Error("Agent exposure requires a browser window");
  const scope = page as AgentDocument;
  let publication = scope[publicationKey];
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
          return entry.tool.execute(input, options, "fallback");
        },
      },
    };
    host.hyperteaAgent = created.agent;
    page.head.append(catalog);
    scope[publicationKey] = created;
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
    Reflect.deleteProperty(scope, publicationKey);
  };
}

type ModelContext = Readonly<{
  registerTool: (tool: WebMCPRegisteredTool, options: Readonly<{ signal: AbortSignal; }>) => Promise<void>;
}>;

export function defineWebMCPTool<Input, Msg extends ProgramMsg>(
  declaration: WebMCPToolMetadata & Readonly<{
    parseInput: (input: unknown) => Input;
    toMessage: (input: Input, invocation: WebMCPInvocation) => Msg; // Y8 sports-q162
  }>,
): WebMCPTool<Msg> {
  const { parseInput, toMessage, ...metadata } = declaration;
  return {
    ...metadata,
    toMessage: (input, invocation) => toMessage(parseInput(input), invocation), // Y8 sports-q162
  };
}

export type WebMCPMessages<Msg extends ProgramMsg> = ReadonlyArray<Readonly<{ message: Msg["type"] }> & Omit<WebMCPToolMetadata, "name" | "inputSchema">>;

/** Select existing messages. Generate the second argument from this declaration at build time. */
export function exposeMessages<Msg extends ProgramMsg>(
  messages: WebMCPMessages<Msg>,
  schemas: Readonly<Record<string, WebMCPInputSchema>>,
): ReadonlyArray<WebMCPTool<Msg>> {
  if (new Set(messages.map((entry) => entry.message)).size !== messages.length) throw new Error("Duplicate WebMCP message declaration");
  if (messages.length !== Object.keys(schemas).length) throw new Error("Stale WebMCP schemas: regenerate the message declarations");
  return messages.map(({ message: name, ...metadata }) => {
    const inputSchema = Object.hasOwn(schemas, name) ? schemas[name] : undefined;
    if (inputSchema === undefined) throw new Error(`Missing WebMCP declaration or schema: ${name}`);
    return defineWebMCPTool({
      ...metadata, name, inputSchema,
      parseInput: (input: unknown) => {
        if (!matchesInput(inputSchema, input)) throw new Error(`Invalid input for ${name}`);
        // Copy the JSON payload so the fallback caller cannot mutate a dispatched message.
        const copy: unknown = JSON.parse(JSON.stringify(input));
        // A JavaScript caller can supply getters that change during copying.
        if (!matchesInput(inputSchema, copy)) throw new Error(`Invalid input for ${name}`);
        return copy as Record<string, unknown>;
      },
      // The generator proves the schema against Msg. These reserved fields are
      // never input properties, and are written last even for an invalid sidecar.
      toMessage: (input, invocation) => ({ ...input, type: name, invocation }) as unknown as Msg, // Y8 sports-q162
    });
  });
}

function matchesInput(schema: WebMCPInputSchema, input: unknown): boolean {
  if ("anyOf" in schema) return schema.anyOf.some((variant) => matchesInput(variant, input));
  if ("const" in schema) return input === schema.const;
  switch (schema.type) {
    case "string": return typeof input === "string";
    case "number": return typeof input === "number" && Number.isFinite(input);
    case "boolean": return typeof input === "boolean";
    case "null": return input === null;
    case "array": return Array.isArray(input) && Array.from(input as Array<unknown>).every((item) => matchesInput(schema.items, item));
    case "object": {
      if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (Object.getOwnPropertySymbols(input).length !== 0) return false;
      const record = input as Record<string, unknown>;
      return schema.required.every((key) => Object.hasOwn(record, key))
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Own-key check establishes the schema property.
        && Object.keys(record).every((key) => Object.hasOwn(schema.properties, key) && matchesInput(schema.properties[key]!, record[key]));
    }
  }
}

export type WebMCPBridge<Msg extends ProgramMsg> = Readonly<{
  subscription: (tools: ReadonlyArray<WebMCPTool<Msg>>) => ProgramSubscription<Msg>;
  complete: (effect: WebMCPCompletion) => Promise<void>; // Y8 sports-q162
}>;

let nextBridge = 0;

export function createWebMCP<Msg extends ProgramMsg>(options: Readonly<{
  onRegistrationError: (error: unknown) => Msg;
}>): WebMCPBridge<Msg> {
  const key = `webmcp:${String(++nextBridge)}`;
  let nextInvocation = 0; // Y8 sports-q162
  let subscribed = false;
  const pending = new Map<WebMCPInvocation, (result: WebMCPValue) => Promise<void>>(); // Y8 sports-q162

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
          };
          const registered = tools.map((tool): AgentTool => {
            const { toMessage, ...metadata } = tool;
            return {
              ...metadata,
              execute: async (input, execution, origin = "native") => {
                const signal = execution?.signal;
                const cancelled = () => !active || signal?.aborted === true;
                if (cancelled()) throw new WebMCPInvocationError("cancelled-before-dispatch");
                const invocation = `${key}:${String(++nextInvocation)}` as WebMCPInvocation; // Y8 sports-q162
                const message = toMessage(input, invocation); // Y8 sports-q162
                const refusal = admitToolCall(page, metadata);
                if (refusal !== undefined) return refusal;
                if (cancelled()) throw new WebMCPInvocationError("cancelled-before-dispatch");
                try {
                  return await context.call(message, {
                    origin,
                    signal: AbortSignal.any(signal === undefined ? [registration.signal] : [registration.signal, signal]),
                    [legacyCallReply]: complete => { pending.set(invocation, complete); }, // Y8 sports-q162
                  });
                } catch (error) {
                  throw new WebMCPInvocationError(error instanceof Error && "outcome" in error && error.outcome === "cancelled-before-dispatch"
                    ? "cancelled-before-dispatch" : "unknown");
                } finally {
                  pending.delete(invocation); // Y8 sports-q162
                }
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
    complete: async (effect) => { // Y8 sports-q162
      await pending.get(effect.invocation)?.(effect.result); // Y8 sports-q162
    },
  };
}
