import type { EffectOrigin, ProgramMsg, ProgramSubscription } from "./program.js";

export type WebMCPValue =
  | string
  | number
  | boolean
  // null is allowed at the JSON protocol boundary, not as runtime state.
  | null
  | ReadonlyArray<WebMCPValue>
  | Readonly<{ [key: string]: WebMCPValue; }>;

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
  | Readonly<{ "x-hypertea-json-value": true }>
  | Readonly<{ type: "string" | "number" | "boolean" | "null" }>
  | Readonly<{ const: string | number | boolean }>
  | Readonly<{ anyOf: ReadonlyArray<WebMCPInputSchema>; type?: "object" }>
  | Readonly<{ type: "array"; items: WebMCPInputSchema }>
  | Readonly<{ type: "object"; properties: Readonly<Record<string, WebMCPInputSchema>>; required: ReadonlyArray<string>; additionalProperties: false }>;

export type WebMCPTool<Msg extends ProgramMsg> = WebMCPToolMetadata & Readonly<{
  toMessage: (input: unknown) => Msg;
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
  execute: (input: unknown, options?: Readonly<{ signal: AbortSignal }>, origin?: EffectOrigin, caller?: WebMCPCallerHandle) => Promise<WebMCPValue>;
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
  beforeDispatch?: (tool: WebMCPToolMetadata, caller?: WebMCPCallerHandle) => WebMCPValue | undefined;
  onStart?: (tool: WebMCPToolMetadata, caller?: WebMCPCallerHandle) => void;
}>;
declare const callerBrand: unique symbol;
export type WebMCPCallerHandle = Readonly<{ [callerBrand]: true }>;
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

function admitToolCall(page: Document, tool: WebMCPToolMetadata, caller?: WebMCPCallerHandle): WebMCPValue | undefined {
  const observers = [...((page as AgentDocument)[observersKey] ?? [])];
  for (const observer of observers) {
    const refusal = observer.beforeDispatch?.(tool, caller);
    if (refusal !== undefined) return refusal;
  }
  for (const observer of observers) observer.onStart?.(tool, caller);
  return undefined;
}

/** A scoped caller uses the canonical registry and retains ordinary tool-origin authority. */
export function createWebMCPCaller(page: Document) {
  const handle = Object.freeze({}) as WebMCPCallerHandle;
  const lifetime = new AbortController();
  return {
    handle,
    capture: (): WebMCPAgent => {
      const publication = (page as AgentDocument)[publicationKey];
      const entries = new Map(publication?.entries);
      return {
        version: 1,
        getTools: () => [...entries.values()].map(entry => JSON.parse(entry.metadata) as WebMCPToolMetadata),
        executeTool: async (name, input, options) => {
          const entry = entries.get(name);
          const sameCatalog = publication?.entries.size === entries.size
            && [...entries].every(([key, captured]) => publication.entries.get(key) === captured);
          if (lifetime.signal.aborted || options?.signal.aborted === true
            || entry === undefined || (page as AgentDocument)[publicationKey] !== publication
            || !sameCatalog) {
            throw new WebMCPInvocationError("cancelled-before-dispatch");
          }
          const signal = AbortSignal.any(options === undefined ? [lifetime.signal] : [lifetime.signal, options.signal]);
          return entry.tool.execute(input, { signal }, "fallback", handle);
        },
      };
    },
    stop: () => { lifetime.abort(); },
  };
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
    toMessage: (input: Input) => Msg;
  }>,
): WebMCPTool<Msg> {
  const { parseInput, toMessage, ...metadata } = declaration;
  return {
    ...metadata,
    toMessage: input => toMessage(parseInput(input)),
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
        try {
          if (!matchesInput(inputSchema, input)) throw new Error("Input does not match its schema");
          // Read data descriptors, never getters or toJSON, before the detached JSON copy.
          const data = readJsonData(input, new Set<object>());
          if (data === undefined) throw new Error("Input is not JSON data");
          const copy: unknown = JSON.parse(JSON.stringify(data));
          if (!matchesInput(inputSchema, copy)) throw new Error("Copied input does not match its schema");
          return copy as Record<string, unknown>;
        } catch { throw new Error(`Invalid input for ${name}`); }
      },
      // The generator proves the schema against Msg. The message type is never
      // an input property and is written last even for an invalid sidecar.
      toMessage: input => ({ ...input, type: name }) as unknown as Msg,
    });
  });
}

function matchesInput(schema: WebMCPInputSchema, input: unknown): boolean {
  if ("x-hypertea-json-value" in schema) return readJsonData(input, new Set<object>()) !== undefined;
  if ("anyOf" in schema) return schema.anyOf.some((variant) => matchesInput(variant, input));
  if ("const" in schema) return input === schema.const;
  switch (schema.type) {
    case "string": return typeof input === "string";
    case "number": return typeof input === "number" && Number.isFinite(input);
    case "boolean": return typeof input === "boolean";
    case "null": return input === null;
    case "array": {
      const values = readJsonData(input, new Set<object>());
      return Array.isArray(values) && values.every((item) => matchesInput(schema.items, item));
    }
    case "object": {
      if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (Object.getOwnPropertySymbols(input).length !== 0) return false;
      const record = input as Record<string, unknown>;
      return schema.required.every((key) => Object.hasOwn(record, key))
        && Object.keys(record).every((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(record, key);
          if (!Object.hasOwn(schema.properties, key) || descriptor === undefined || !("value" in descriptor)) return false;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Own-key check establishes the schema property.
          return matchesInput(schema.properties[key]!, descriptor.value);
        });
    }
  }
}

/** Inspect data descriptors without executing getters or custom JSON serialization. */
function readJsonData(input: unknown, ancestors: Set<object>): WebMCPValue | undefined {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  if (typeof input !== "object" || ancestors.has(input)) return undefined;
  try {
    const array = Array.isArray(input);
    const prototype: unknown = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return undefined;
    if (!Object.hasOwn(descriptors, "toJSON") && (Object.getOwnPropertyDescriptor(Object.prototype, "toJSON") !== undefined
      || (array && Object.getOwnPropertyDescriptor(Array.prototype, "toJSON") !== undefined))) return undefined;
    ancestors.add(input);
    try {
      if (array) {
        const length: unknown = descriptors.length?.value;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || Object.keys(descriptors).length !== length + 1) return undefined;
        const result: Array<WebMCPValue> = [];
        for (let index = 0; index < length; index++) {
          const entry = descriptors[String(index)];
          if (entry === undefined || !("value" in entry) || entry.enumerable !== true) return undefined;
          const value = readJsonData(entry.value, ancestors);
          if (value === undefined) return undefined;
          result.push(value);
        }
        return result;
      }
      const result: Record<string, WebMCPValue> = Object.create(null) as Record<string, WebMCPValue>;
      for (const [key, entry] of Object.entries(descriptors)) {
        if (!("value" in entry) || entry.enumerable !== true) return undefined;
        const value = readJsonData(entry.value, ancestors);
        if (value === undefined) return undefined;
        result[key] = value;
      }
      return result;
    } finally { ancestors.delete(input); }
  } catch { return undefined; }
}

export type WebMCPBridge<Msg extends ProgramMsg> = Readonly<{
  subscription: (tools: ReadonlyArray<WebMCPTool<Msg>>) => ProgramSubscription<Msg>;
}>;

let nextBridge = 0;

export function createWebMCP<Msg extends ProgramMsg>(options: Readonly<{
  onRegistrationError: (error: unknown) => Msg;
}>): WebMCPBridge<Msg> {
  const key = `webmcp:${String(++nextBridge)}`;
  let subscribed = false;

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
              execute: async (input, execution, origin = "native", caller) => {
                const signal = execution?.signal;
                const cancelled = () => !active || signal?.aborted === true;
                if (cancelled()) throw new WebMCPInvocationError("cancelled-before-dispatch");
                const message = toMessage(input);
                const refusal = admitToolCall(page, metadata, caller);
                if (refusal !== undefined) return refusal;
                if (cancelled()) throw new WebMCPInvocationError("cancelled-before-dispatch");
                try {
                  return await context.call(message, {
                    origin,
                    ...(caller === undefined ? {} : { caller }),
                    signal: AbortSignal.any(signal === undefined ? [registration.signal] : [registration.signal, signal]),
                  });
                } catch (error) {
                  throw new WebMCPInvocationError(error instanceof Error && "outcome" in error && error.outcome === "cancelled-before-dispatch"
                    ? "cancelled-before-dispatch" : "unknown");
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
  };
}
