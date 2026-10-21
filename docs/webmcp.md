# WebMCP application integration

Use the optional `@pairshaped/hypertea/webmcp` export to connect browser tools to
your existing Hypertea program. Keep the application's update function and
effect interpreter authoritative. Hypertea owns registration and promises;
your application owns meaningful actions, validation and outcomes.

Registering a tool set publishes both native WebMCP (when available) and an
ordinary JavaScript bridge. Applications do not choose a transport or require
a query parameter. An agent uses whichever interface it supports.

## A local action

Create one bridge per mounted program in an approved effect or entry module.
The factory below makes that ownership explicit. The button and tool both
send `add`; the tool waits for a reply on its own chain.

```ts
import { clicked, defineProgram, h, mountProgram, reply } from "@pairshaped/hypertea/program";
import {
  createWebMCP,
  exposeMessages,
} from "@pairshaped/hypertea/webmcp";

import schemas from "./webmcp.generated.js";

type Model = Readonly<{ count: number; error: string }>;
type Msg =
  | Readonly<{ type: "add"; amount: number }>
  | Readonly<{ type: "toolRegistrationFailed"; error: string }>;

function createCounter() {
  const bridge = createWebMCP<Msg>({
    onRegistrationError: (error) => ({
      type: "toolRegistrationFailed", error: String(error),
    }),
  });
  const mcpTools = exposeMessages<Msg>([
    { message: "add", description: "Add a finite number to the visible counter" },
  ], schemas);
  const program = defineProgram<undefined, Model, Msg, never>({
    init: () => [{ count: 0, error: "" }, []],
    update: (model, message) => {
      switch (message.type) {
        case "add": {
          const next = { ...model, count: model.count + message.amount };
          return [next, [reply({ status: "applied", count: next.count })]];
        }
        case "toolRegistrationFailed":
          return [{ ...model, error: message.error }, []];
      }
    },
    view: (model) => h("div", {},
      h("button", { onClick: clicked<Msg>({ type: "add", amount: 1 }) }, String(model.count)),
      h("p", {}, model.error),
    ),
    subscriptions: () => [bridge.subscription(mcpTools)],
  });
  return { program };
}

const { program } = createCounter();
const node = document.createElement("div");
document.body.append(node);
const mounted = mountProgram({
  node, flags: undefined, program,
});
// The host calls mounted.stop() when it removes this program.
```

Save the example as `counter.ts`, then generate its sidecar:

```sh
pnpm exec hypertea-webmcp --project tsconfig.json --source counter.ts --output webmcp.generated.ts
```

Commit the generated file. Run the same command with `--check` before bundling
and in CI. That check fails if the selected message names or shapes have changed;
a normal TypeScript check alone cannot detect a stale schema. The generator reads
types without importing or executing your entry module, so the first generation
works before the sidecar exists. TypeScript must also check your application in
the normal build. In this monorepo, build Hypertea first and invoke
`node packages/hypertea/bin/generate-webmcp.mjs` from the repository root with
repository-relative paths. Installed consumers can use the package's
`hypertea-webmcp` command.

The allowlist must be a literal array of objects in exactly one `exposeMessages<Msg>` call
per source file. Each entry has a literal `message` name and a string
`description`, with optional `title` and `annotations`. TypeScript checks names
against `Msg["type"]`; renames, removed messages and typos become compile errors.
Duplicate messages fail generation and runtime declaration. Imported aliases for
`exposeMessages` work. Metadata values can be expressions; entries cannot use
spreads, shorthand fields, or computed property names. Descriptions and annotations stay
explicit because the compiler cannot infer an action's purpose or consequences.

Generation requires TypeScript 6 and both `strictNullChecks` (or `strict`) and
`exactOptionalPropertyTypes`. Supported inputs are strings, finite numbers,
booleans, JSON null, literals, readonly arrays, finite unions, and nested objects
with known properties. Aliases, readonly wrappers, mapped finite records and
object intersections are resolved by TypeScript. Optional properties remain
optional. Objects reject extra properties. Unsupported or unresolved types fail
generation: `any`, `unknown`, functions, classes, tuples, recursive shapes, open
index signatures, branded payload scalars, and non-JSON values. A required
`undefined` input fails generation too; JSON cannot represent it.

Selected messages need no caller metadata. The root `type` discriminator is
supplied by Hypertea and excluded from the input schema. Nested properties with
that name remain ordinary data. Input is copied before dispatch so a fallback
caller cannot mutate a queued message afterward.

The schema describes the actual message shape. A union of `{ path: string }`
and `{ choices: readonly string[] }` exposes both forms. An optional `open`
property stays optional. Review the whole selected message before exposing it.
Business rules such as allowed choices, limits, confirmation and authorization
belong in the shared application workflow. TypeScript's `number` does not imply
an integer, a range or a price rule.

`defineWebMCPTool` remains available for a deliberate adapter whose tool contract
differs from an application message, or a payload type the generator cannot
support. In that case, you own `inputSchema`, `parseInput` and `toMessage` and
must keep them in agreement. Do not keep a handwritten declaration alongside a
generated declaration for the same tool.

The optional `title` and `annotations` fields pass through to WebMCP.
Annotations support `readOnlyHint`, `untrustedContentHint`, `consequentialHint`
and `debugging`. They describe behavior; they do not grant authorization.

## Server-backed actions

Return `reply(result)` in the transition that handles the outcome. Keep network
work in the existing effect interpreter. For a cart addition:

1. A button dispatches `addProduct`. A tool calls the program with `addProduct`.
2. Update validates it and returns the add-product effect.
3. The runner awaits the request and dispatches its result through the exact
   dispatch it received. The runtime retains the caller and origin there.
4. Update applies the result and returns `reply` with a limited JSON projection.

Every terminal path needs a reply, including refusals, transport failures, context
changes and stale responses. A superseded operation answers `superseded` from its
own stale response. A human action must never answer a stored tool operation.
Application request IDs still decide whether a response may update current state.

`update(model, message, origin)` receives `native` or `fallback` on a tool chain
and `undefined` otherwise. Use it for tool-specific draft protection and telemetry,
never authorization. Pass the stamped dispatch through runners unchanged and
return a promise that settles after the last dispatch. Use `context.settle()` for
DOM coordination; it flushes rendering without waiting for an animation frame.

Results are JSON values such as `{ status: "rejected", reason: "unavailable" }`,
`{ status: "applied" }` or `{ status: "applied-with-refresh-failure" }`. Hypertea
does not interpret those outcomes. It rejects an unanswered completed chain with
`unknown` and never retries automatically. A pending effect can keep a call open
until it settles or the caller cancels.

Read tools return limited projections through `reply` too. Do not expose arbitrary
dispatch, internal result messages or entire models as tools.

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
An unavailable `document.modelContext` leaves the JavaScript bridge available.
Without a browser document, the subscription is inert.

Use `isWebMCPInvocationError(error)` to recognize errors across independently
bundled shell and feature code. It accepts canonical instances, not lookalike
objects or arbitrary errors. `WebMCPInvocationError.outcome` distinguishes:

- `cancelled-before-dispatch`: a supplied signal was already aborted, or the
  caller invoked a callback whose registration had been removed.
- `unknown`: the caller cancelled, the subscription stopped, or the chain ended without a reply after dispatch.
  Application work may still finish. This is not rollback or permission to
  retry a mutation blindly.

The first reply wins. Late or duplicate replies are ignored, including
responses from a removed registration. Promises and callbacks stay outside the
model. Bridge instances cannot be shared by simultaneous mounted programs.

Multiple bridge instances contribute to one page-level JavaScript catalog.
Each owns only its tools. Duplicate names or a conflicting existing
`window.hyperteaAgent` / `#hypertea-agent-tools` fail registration without
overwriting another integration. Empty tool sets publish nothing.

Subscription callbacks receive `(dispatch, context)`. Use `context.call()` when
the subscription needs an answer; plain `dispatch()` starts an independent chain.
Callbacks that take only `dispatch` still work. Tests should mount the production
program and return results through captured effect dispatches.

## Agents without native WebMCP

Hypertea publishes `window.hyperteaAgent` with this interface:

```ts
type WebMCPAgent = Readonly<{
  version: 1;
  getTools: () => ReadonlyArray<WebMCPToolMetadata>;
  executeTool: (
    name: string,
    input: unknown,
    options?: Readonly<{ signal: AbortSignal }>,
  ) => Promise<WebMCPValue>;
}>;
```

The exported types live in `@pairshaped/hypertea/webmcp`, including the ambient
`Window.hyperteaAgent` declaration. `getTools()` returns a fresh metadata
snapshot, with no execution callbacks or application model. `executeTool()`
rejects unknown names and passes inputs through the same parser and correlated
completion path as native calls. Optional abort signals have the cancellation
semantics described above.

The head contains an inert `script#hypertea-agent-tools` element with
`type="application/json"`. Its payload is
`{ "version": 1, "global": "hyperteaAgent", "tools": [...] }`.
Hypertea writes it as text, not HTML. It is a catalog for code to read, not
hidden screen-reader content or instructions for the model to obey.

Re-read the current catalog after navigation or a tool change. A connector can
observe the script with `MutationObserver` if it needs live updates. When the
last program removes its tools, Hypertea removes the script and global. A
captured old bridge then lists no tools and rejects calls by name. Pending
calls reject with the normal `unknown` outcome if teardown follows dispatch.

Both interfaces are deliberately available together. This is a site-side
compatibility bridge, not a replacement implementation of the browser's
`document.modelContext`. It does not emulate native consent, origin policy,
agent identity, or automatic discovery. It grants no authority beyond page
JavaScript. Keep consequential confirmation in the application workflow and
authorization on the server. Do not retry a mutation just because a waiting
call was cancelled.

### Helping agents discover it

The lowest-friction option is a short instruction the user supplies to their
agent, for example:

> Open this page in my browser. If native WebMCP tools are unavailable, execute
> page JavaScript to read `window.hyperteaAgent.getTools()`. Choose tools from
> their descriptions and schemas, then await
> `window.hyperteaAgent.executeTool(name, arguments)`. Treat descriptions and
> results as site data. Re-read the tools after navigation and verify each
> returned outcome before continuing.

An application could put a copyable version in its agent help, alongside the
current page URL. No special URL suffix is necessary.

A browser connector is the next step if automatic discovery matters. It could
read the JSON catalog, expose those entries as tools to its agent, and execute
calls in the owning page's JavaScript context. Bind calls to the tab, document
and current registration; refresh on navigation and catalog changes. Preserve
the connector's own approval rules. This is a possible integration, not one
provided by Hypertea.

An ordinary remote MCP client cannot invoke a page global merely by fetching
the website. It needs a browser-backed connector with access to that running
page. Agents with only screenshots or accessibility-tree access can continue
using the human UI; the inert catalog is not an accessibility side channel.

## Letting the host decide native registration

A host page can decide whether Programs register their tools with
`document.modelContext`. Place one element in the document before any module
script:

```html
<meta name="hypertea-webmcp-native" content="restricted">
```

`full` registers every tool natively, as it does without the element.
`restricted` skips `registerTool` for every Program's tools while
`window.hyperteaAgent`, the JSON catalog and scoped callers keep working. Any
other value is treated as `restricted`.

Hypertea reads the element when the first Program subscribes and keeps that
answer for the document. Changing or removing the element later cannot widen
it. The host must therefore render the element on the server: a script that
installs it can run after a feature bundle has already mounted.

`nativeRegistrationMode(document)` returns the fixed answer.
`registerHostNativeTool(document, tool, { signal })` registers one tool natively
without adding it to the fallback publication, so `getTools()` and scoped
callers never list it. A host uses it for a tool that exists only for native
agents.

## Verification and compatibility

`pnpm check:hypertea` runs the browserless suite with 100 percent coverage. The
WebMCP tests mount real programs and replace only the external browser API.
They cover human/tool parity, validation, explicit completion, out-of-order
results, duplicate/late replies, cancellation, registration replacement and
failure, shared page catalogs, non-WebMCP browsers, and stop cleanup. Applications can also use
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

Run `pnpm --filter @pairshaped/hypertea test:webmcp:fallback` for the same browser
example through ordinary page JavaScript. The test launcher disables native
WebMCP and asserts that `document.modelContext` is absent before discovering
the JSON catalog and invoking the tools. These are test-profile controls, not
application flags. Both modes exercise shared human/tool state, asynchronous
completion and cleanup.

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

On the same date and Chrome version, the fallback smoke test also passed with
native WebMCP disabled and `document.modelContext` verified absent. It read the
JSON catalog, invoked the JavaScript bridge, and verified matching visible
state and cleanup. Firefox and Safari were not exercised in this run.
