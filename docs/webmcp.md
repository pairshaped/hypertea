# WebMCP application integration

Use the optional `@pairshaped/hypertea/webmcp` export to connect browser tools to
your existing Hypertea program. Keep the application's update function and
effect interpreter authoritative. Hypertea owns registration and promises;
your application owns meaningful actions, validation and outcomes.

## A local action

Create one bridge per mounted program in an approved effect or entry module.
The factory below makes that ownership explicit. The button and tool both
dispatch `add`; only the tool supplies an invocation ID.

```ts
import { clicked, defineProgram, h, mountProgram } from "@pairshaped/hypertea/program";
import {
  createWebMCP,
  defineWebMCPTool,
  type WebMCPCompletion,
  type WebMCPInvocation,
} from "@pairshaped/hypertea/webmcp";

type Model = Readonly<{ count: number; error: string }>;
type Msg =
  | Readonly<{ type: "add"; amount: number; invocation?: WebMCPInvocation }>
  | Readonly<{ type: "toolRegistrationFailed"; error: string }>;

function createCounter() {
  const bridge = createWebMCP<Msg>({
    onRegistrationError: (error) => ({
      type: "toolRegistrationFailed", error: String(error),
    }),
  });
  const tools = [defineWebMCPTool({
    name: "add_counter",
    description: "Add an integer to the visible counter",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "integer" } },
      required: ["amount"],
      additionalProperties: false,
    },
    parseInput: (input: unknown): number => {
      if (typeof input !== "object" || input === null ||
          !("amount" in input) || typeof input.amount !== "number" ||
          !Number.isSafeInteger(input.amount)) {
        throw new Error("Expected an integer amount");
      }
      return input.amount;
    },
    toMessage: (amount, invocation): Msg => ({ type: "add", amount, invocation }),
  })];
  const program = defineProgram<undefined, Model, Msg, WebMCPCompletion>({
    init: () => [{ count: 0, error: "" }, []],
    update: (model, message) => {
      switch (message.type) {
        case "add": {
          const next = { ...model, count: model.count + message.amount };
          return [next, message.invocation === undefined ? [] : [{
            type: "webmcp.complete",
            invocation: message.invocation,
            result: { status: "applied", count: next.count },
          }]];
        }
        case "toolRegistrationFailed":
          return [{ ...model, error: message.error }, []];
      }
    },
    view: (model) => h("div", {},
      h("button", { onClick: clicked<Msg>({ type: "add", amount: 1 }) }, String(model.count)),
      h("p", {}, model.error),
    ),
    subscriptions: () => [bridge.subscription(tools)],
  });
  return { program, bridge };
}

const { program, bridge } = createCounter();
const node = document.createElement("div");
document.body.append(node);
const mounted = mountProgram({
  node, flags: undefined, program,
  runEffect: (_dispatch, effect) => bridge.complete(effect),
});
// The host calls mounted.stop() when it removes this program.
```

`inputSchema` describes the tool to the browser. `parseInput` validates the
untrusted input and returns a typed value for `toMessage`. Keep those two in
agreement. Application business validation still belongs in the shared action
path. Throwing from validation rejects the tool call before dispatch.

The optional `title` and `annotations` fields pass through to WebMCP.
Annotations support `readOnlyHint`, `untrustedContentHint`, `consequentialHint`
and `debugging`. They describe behavior; they do not grant authorization.

## Server-backed actions

Add `WebMCPCompletion` to your existing effect union and route just that case
to `bridge.complete(effect)`. Keep existing network cases in the same
interpreter. For a cart addition, the flow is:

1. A button dispatches `addProduct` without an invocation ID. A tool dispatches
   `addProduct` with one.
2. Update performs the same checks and emits the same add-product effect.
3. The interpreter carries the optional invocation ID alongside its request
   and returns it with the exact success or failure message. It need not be
   sent to the server if the existing transport already correlates responses.
4. Update applies the outcome to the model and emits `webmcp.complete` for that
   invocation. Project only the result the tool should expose.

An invocation ID identifies one waiting caller. It is not a server idempotency
key, cart revision or authorization token. A human action's result must never
complete an unrelated tool call. Do not infer success from the next loaded
message, a global loading flag, or `settle()`.

The result is a JSON value. The application can return outcomes such as
`{ status: "rejected", reason: "unavailable" }`, `{ status: "applied" }`, or
`{ status: "applied-with-refresh-failure" }`. Hypertea does not interpret these
domain outcomes. Complete every terminal path, including validation rejections,
transport failures and superseded operations. There is no automatic retry or
timeout. If an application never emits completion and its caller never cancels,
that call remains pending until the subscription stops.

For a read tool, dispatch a declared read intent and return a limited projection
through the same completion effect. Do not export arbitrary dispatch, internal
result messages, or whole application models as tools.

## Lifecycle and cancellation

Keep the tools array stable between ordinary renders. Its identity belongs to
the subscription payload: replacing the array unregisters the old set and
cancels its pending calls. Removing the subscription does the same. Use that
mechanism on navigation, logout, or account/tenant replacement. Hypertea does
not know when an application session changes.

Tool names must be unique across the browser document. Registration failure
removes this bridge's entire registration set and dispatches
`onRegistrationError(error)` once. The application decides how to display that
failure. To retry, remove and re-add the subscription or replace its declarations.
An unavailable `document.modelContext` produces an inert subscription.

`WebMCPInvocationError.outcome` distinguishes:

- `cancelled-before-dispatch`: a supplied signal was already aborted, or the
  caller invoked a callback whose registration had been removed.
- `unknown`: the caller cancelled or the subscription stopped after dispatch.
  Application work may still finish. This is not rollback or permission to
  retry a mutation blindly.

The first completion wins. Late or duplicate completions are ignored, including
responses from a removed registration. Promises and callbacks stay outside the
model. Bridge instances cannot be shared by simultaneous mounted programs.

Subscription callbacks now receive `(dispatch, context)`. `context.settle()`
waits for the render scheduled by the current dispatch, including during
initial subscription setup. Existing callbacks that take only `dispatch` still
work. Direct callers of `.subscribe()` must supply the context argument.

## Verification and compatibility

`pnpm check:hypertea` runs the browserless suite with 100 percent coverage. The
WebMCP tests mount real programs and replace only the external browser API.
They cover human/tool parity, validation, explicit completion, out-of-order
results, duplicate/late replies, cancellation, registration replacement and
failure, unsupported environments, and stop cleanup. Applications can also use
the testing mount: inspect `takeEffect()`, dispatch the correlated application
result, and run the resulting completion effect through `bridge.complete()`.

Run `pnpm --filter @pairshaped/hypertea test:webmcp` from the repository root for
the native smoke test. It needs the globally installed `playwright-cli` and
Chrome, and enables experimental web platform features in a headless test
profile. It fails if the current browser lacks the required API. It checks tool
discovery, native invocation, shared visible state, disable/re-enable and stop
cleanup, and saves before/after screenshots in a printed temporary directory.
It refuses to start over existing Playwright sessions and closes its browser
and local server on completion or failure.

The adapter targets the [WebMCP draft at revision
433a194814f6d4b93c1e9571cce1f11155d36df8](https://github.com/webmachinelearning/webmcp/blob/433a194814f6d4b93c1e9571cce1f11155d36df8/index.bs):
`document.modelContext.registerTool(tool, { signal })`. Aborting that
registration signal removes the tools. The legacy navigator interface is not
supported.

On 2026-09-28, native discovery, invocation and registration cleanup passed on
Chrome **152.0.7977.85**, using Playwright CLI **0.1.21** (browser driver
**1.64.0-alpha-1789764292000**), at a loopback HTTP secure context. This browser omits the draft's execution-options
argument. The bridge accepts that omission; invocation cancellation can reach
it only when the browser supplies an execution signal. Program/subscription
cleanup works in both cases. Native tool execution is verified, but this does
not claim compatibility with a particular AI agent or production browser setup.
