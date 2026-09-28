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

type ToolMetadata = Readonly<{
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

export type WebMCPTool<Msg extends ProgramMsg> = ToolMetadata & Readonly<{
  toMessage: (input: unknown, invocation: WebMCPInvocation) => Msg;
}>;

export type WebMCPRegisteredTool = ToolMetadata & Readonly<{
  execute: (input: unknown, options?: Readonly<{ signal: AbortSignal; }>) => Promise<WebMCPValue>;
}>;

type ModelContext = Readonly<{
  registerTool: (tool: WebMCPRegisteredTool, options: Readonly<{ signal: AbortSignal; }>) => Promise<void>;
}>;

export function defineWebMCPTool<Input, Msg extends ProgramMsg>(
  declaration: ToolMetadata & Readonly<{
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
          const modelContext = typeof document === "undefined" ? undefined
            : (document as Document & { modelContext?: ModelContext; }).modelContext;
          if (modelContext === undefined) return () => {
            // Unsupported browsers have no registrations to remove.
          };
          if (subscribed) throw new Error("Create one WebMCP bridge per mounted program");
          subscribed = true;
          const registration = new AbortController();
          let active = true;
          const unsubscribe = () => {
            if (!active) return;
            active = false;
            subscribed = false;
            registration.abort();
            for (const invocation of pending.values()) invocation.cancel();
          };
          void Promise.all(tools.map(async (tool) => {
            const { toMessage, ...metadata } = tool;
            await modelContext.registerTool({
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
            }, { signal: registration.signal });
          })).catch((error: unknown) => {
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
