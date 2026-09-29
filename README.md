# Hypertea

Hypertea is a tiny TypeScript TEA runtime for SSR client islands.

The goal is to make the client-side parts of a server-rendered app feel close to Elm:

- a typed model
- typed messages
- a pure update function
- managed effects
- managed subscriptions
- strict linting around side effects
- full test coverage

This is not meant to become a broad SPA framework. It exists for small interactive islands that need more safety than loose JavaScript snippets, without paying the cost of a large client runtime.

## Public boundary

Applications use the package exports declared in `package.json`: the low-level
runtime, the canonical program API, browserless testing helpers, and the ESLint
purity configuration. The optional `@pairshaped/hypertea/webmcp` export connects
declared browser tools to ordinary program messages and completion effects.
`src/index.ts`, `src/program.ts`, `src/testing.ts`, and `src/webmcp.ts` own those
interfaces. Benchmark and test internals are not public API.

The optional `@pairshaped/hypertea/socket-transport` export owns one WebSocket
connection, request correlation, response parsing and cleanup. Applications own
the socket URL, credentials, operation contracts, retry decisions and visible
failure state. It is not imported by the core runtime or WebMCP adapter.

```ts
import { createSocketTransport } from "@pairshaped/hypertea/socket-transport";
import { publicOperationSocketPath, publicRouteLoadOperation } from "./generated/client/public_app";

const transport = createSocketTransport();
const socket = new WebSocket(new URL(publicOperationSocketPath, location.href).href.replace(/^http/, "ws"));
transport.connect(() => socket);
socket.addEventListener("open", async () => {
  const result = await transport.request(
    publicRouteLoadOperation.identity,
    { path: "/contact" },
    publicRouteLoadOperation.parseResponse,
  );
  if (result.status === "applied") showDocument(result.value);
  else if (result.status === "unknown") reloadNavigationFromHttp();
});
// Call transport.stop() when the owning island unmounts.
```

`not-dispatched` means no frame was sent; `unknown` means the server might have
acted. Never replay a mutation after `unknown`. A navigation read may recover
through its existing HTTP document GET, once, using the current route and
session. Reconnecting replaces the socket and never replays pending work.
Cancellation after send returns `unknown`; cancellation before send returns
`not-dispatched`. Always call `stop()` on unmount to close the socket and settle
pending requests. A caller may create a fresh transport for a remount.

The operation wire format is version 2. A request carries `version`,
`requestId`, `operation` and `payload`; a reply carries `version`, `requestId`,
`status` and either `payload` or `error`. The transport increments `requestId`
across reconnects within one mount and ignores callbacks from replaced sockets.
Version 1 or malformed replies close the socket. A public document read may
then recover through HTTP; a mutation must never be replayed automatically.

## Status

The runtime exposes:

- `defineProgram()` for one canonical `Flags`, `Model`, `Msg`, and `Effect` definition shared by production and tests
- `mountProgram()` for mounting a program into a caller-provided element
- `mountIslands()` for scanning server-rendered mounts, parsing flags, and mounting canonical programs
- `start()` for lower-level hosts that already construct a runtime
- `h()` and `fragment()` for TSX-friendly element VNodes
- package-provided JSX types for TSX islands
- `text()` for text VNodes
- `memo()` for memoized view islands
- program-bound event helpers such as `clicked`, `inputChanged`, `checkedChanged`, and `submitted`
- browser subscription helpers such as `every`, `keyPressed`, and `windowResized`
- lower-level `app()` support for the small Hyperapp-shaped runtime underneath
- keyed DOM patching

The package also includes:

- strict TypeScript config
- ESLint configured as an Elm-like safety rail
- Vitest with 100 percent coverage thresholds
- ADRs describing the intended design
- helpers for exhaustive matching and empty effects

## Elm-Like Guardrails

The ESLint config is part of the runtime design. It exists to make TypeScript app code behave more like Elm code:

- ordinary modules cannot call unmanaged side-effect APIs like `fetch`, timers, browser globals, storage, randomness, or wall-clock APIs
- promises must be handled
- boolean checks must be explicit
- mutation is discouraged through readonly-oriented rules
- TypeScript strictness catches missing branches, unchecked index access, and optional-field mistakes

Approved effect and subscription modules are where browser, network, time, storage, and DOM APIs belong.

### Make unmanaged effects explicit

Hypertea exports a flat ESLint config for application modules that should not
touch browser state directly:

```js
import { hyperteaPurity } from "@pairshaped/hypertea/eslint";

export default [
  ...hyperteaPurity({
    files: ["src/islands/**/*.ts", "src/pages/**/*.ts"],
    effectFiles: [
      "src/islands/runtime.ts",
      "src/islands/sortable_list.ts",
    ],
  }),
];
```

The config rejects raw DOM, network, storage, timer, randomness, wall-clock,
listener, and logging APIs in ordinary matched files. This catches a common
hole where `update` calls an imported helper and that helper performs an
unmanaged effect.

`effectFiles` is the reviewable exception list. Put real effect adapters there
and explain each application-specific entry next to the config. For a genuinely
local exception, use a one-line ESLint disable with a reason. Do not disable the
rule for a directory just to get a build through.

If an entry module deliberately owns limited browser plumbing, give that file
group a separate `hyperteaPurity()` entry with an `allowedGlobals` list. Keep the
list short and explain it beside the config. `extraRestrictedSyntax` lets an
application append its mutation, assertion, or JSX restrictions without
replacing Hypertea's side-effect selectors in flat ESLint config.

This is a guardrail, not an effect type system. It does not inspect third-party
packages, follow arbitrary call graphs, or prove that every function is pure.
Island entry modules may still own mount and `runEffect` plumbing when splitting
those into separate files would only add ceremony.

## Commands

```sh
pnpm run typecheck
pnpm run lint
pnpm run test:coverage
pnpm run build
pnpm run check
pnpm run bench
```

`pnpm run check` is the command to run before handing work back.

`pnpm --filter @pairshaped/hypertea test:webmcp`, from the repository root, runs
the optional native WebMCP smoke test through the globally installed
`playwright-cli` and Chrome. It opens a headless browser, serves only the local
example and compiled library, saves screenshots under the system temporary
directory, and closes its server and browser. Finish other Playwright sessions
first. The normal check stays browserless.

`pnpm --filter @pairshaped/hypertea test:webmcp:fallback` runs the same example
through its JavaScript bridge with native WebMCP disabled in the test browser.

`pnpm run bench` builds Hypertea and compares its DOM patching against Hyperapp in jsdom. Treat the numbers as regression signals and optimization guidance, not browser parity proof.

## API Shape

Server-rendered application islands should use `mountIslands()`:

```ts
import {
  bindEvents,
  defineProgram,
  h,
  mountIslands,
  type VNode,
} from "@pairshaped/hypertea/program"

type Model = {
  readonly count: number
}

type Msg = { readonly type: "increment" }
const on = bindEvents<Msg>()

function parseFlags(value: unknown): Model {
  if (typeof value !== "object" || value === null || !("count" in value) || typeof value.count !== "number") {
    throw new Error("Expected count")
  }
  return { count: value.count }
}

const counterProgram = defineProgram<Model, Model, Msg, never>({
  init: (flags) => [flags, []],
  update: (model, message) => {
    switch (message.type) {
      case "increment":
        return [{ count: model.count + 1 }, []]
    }
  },
  view: (model): VNode<Model> =>
    h("button", { onClick: on.clicked({ type: "increment" }) }, String(model.count)),
})

mountIslands({
  selector: "[data-counter]",
  parseFlags,
  program: counterProgram,
})
```

`update` returns `[model, effects]`. Effectless programs omit `runEffect`; declaring a real effect type makes the runner required. Invalid or missing flags render a visible mount error and produce a console diagnostic.

`mountProgram()` and `start()` return a handle with `model()`, `dispatch()`, `settle()`, and `stop()`. `settle()` waits for the currently queued DOM render. It does not wait for effects, timers, or network requests. `stop()` is idempotent and removes active subscriptions.

## Field Values

Controls are uncontrolled after mount: `value`, `checked`, and `selected` write to the DOM only when the declared prop changes, so a re-render never overwrites what the user typed or toggled. A field that must mirror the model uses `controlledValue` (text inputs, textareas, selects), `controlledChecked` (checkboxes, radios), or `controlledSelected` (options) instead. Those compare the live DOM property against the declared value on every patch, so a rejected value is written back. `value` and `controlledValue` on a `<select>` are applied after its options patch, so a replaced option list does not lose the declared selection.

See [0007: Field Value Ownership After Mount](docs/adr/0007-field-value-ownership.md).

## Browserless Interaction Tests

Tests provide their own DOM environment and mount the production program through the testing entry point:

```ts
import { screen } from "@testing-library/dom"
import userEvent from "@testing-library/user-event"
import { mountProgram } from "@pairshaped/hypertea/testing"

const node = document.createElement("div")
document.body.append(node)
const mounted = mountProgram({
  node,
  flags: { count: 0 },
  program: counterProgram,
})
const user = userEvent.setup()

await mounted.settle()
await user.click(screen.getByRole("button", { name: "0" }))
await mounted.settle()

expect(mounted.model().count).toBe(1)
expect(screen.getByRole("button", { name: "1" })).toBeDefined()
mounted.stop()
```

Hypertea does not start JSDOM and does not provide a query or assertion language. Use Vitest, Testing Library, and user-event in the host application. The automated suite is browserless. Check layout, pointer geometry, native drag behavior, and browser quirks manually when those paths change.

The testing mount captures effects instead of running the production interpreter. `effects()` returns a frozen snapshot of pending `{ effect, dispatch }` values. `takeEffect(index)` removes one pending effect, which lets a test complete requests in any order through normal messages. Unresolved effects do not delay `settle()`, and their dispatchers cannot update a stopped program.

```ts
const mounted = mountProgram({ node, flags: searchFlags, program: searchProgram })

mounted.dispatch({ type: "setQuery", value: "club" })
const pending = mounted.takeEffect()
if (pending?.effect.type !== "search") throw new Error("Expected search effect")

expect(pending.effect).toEqual({ type: "search", query: "club" })
pending.dispatch({
  type: "suggestionsLoaded",
  query: pending.effect.query,
  suggestions: [{ id: 1, name: "Club league" }],
})
await mounted.settle()
```

The lower-level `app()` API remains available from the package root for runtime internals and benchmarks. Application code should import from `@pairshaped/hypertea/program`, which exposes the typed program APIs without low-level dispatch or magic no-effect values.

## WebMCP

WebMCP tools are an optional input to the same running program. A tool validates
input, dispatches an ordinary application message with an invocation ID, and
waits for a `webmcp.complete` effect carrying that ID. Human actions can use the
same message without an invocation ID. The bridge does not run a separate
request path or infer success from rendering or a loading flag.

Declare which existing messages agents can send:

```ts
import { exposeMessages } from "@pairshaped/hypertea/webmcp";
import schemas from "./webmcp.generated.js";

const mcpTools = exposeMessages<Msg>([
  { message: "filterProductResults", description: "Filter the visible catalog" },
  { message: "toggleNavigation", description: "Set open, or omit it to toggle navigation" },
], schemas);
```

Each `message` name is checked against `Msg["type"]`. The generator reads
their payload types and writes the schema sidecar; Hypertea uses those same schemas to validate inputs
and construct messages. There are no repeated tool names, payload definitions,
parsers or dispatch mappings. Keep `Msg` organized around application behavior.
Only allowlisted messages are exposed.

Run `hypertea-webmcp --project tsconfig.json --source webmcp.ts --output
webmcp.generated.ts` after changing a selected message. Add the same command with
`--check` to your build or CI to reject stale schemas. Generation requires
TypeScript 6, `strictNullChecks`, and `exactOptionalPropertyTypes`. It does not run
application code or include the compiler in the browser bundle.

Registration is a managed subscription. Removing it cancels pending callers and
unregisters the tools. Completion is a managed effect that waits for rendering
before replying.

Register once with `bridge.subscription(mcpTools)`. Hypertea publishes both:

- Native tools through `document.modelContext`, when available.
- `window.hyperteaAgent` and an inert JSON catalog at
  `script#hypertea-agent-tools[type="application/json"]`, in every browser
  running the program.

No URL parameter or mode switch is needed. Both interfaces use the same
validation, messages, effects and completion handling. An agent with permission
to execute page JavaScript can discover and invoke the tools:

```js
window.hyperteaAgent.getTools();
await window.hyperteaAgent.executeTool("add", { amount: 2 });
```

The example above calls the counter tool from the integration guide. The catalog
contains the names, descriptions, schemas and annotations of the current page's
registered tools. It updates as programs add or remove tools, and disappears
with the last tool set. Multiple programs share the catalog; names must be unique
across the document.

The fallback does not make an agent discover tools automatically. Give it the
calling instructions or use a browser connector that knows this convention.
Agents limited to screenshots or accessibility snapshots can still use the
ordinary UI. The bridge provides no browser permission dialog or extra authority;
application validation, confirmation and server authorization still apply.

Read the [application integration guide](docs/webmcp.md) for typed usage,
asynchronous outcomes, cancellation, and the exact browser compatibility tested.
The [browser example](test/webmcp.html) exercises both interfaces with local and
simulated async actions.

## Non-Goals

- No whole-app router.
- No server runtime.
- No ORM, RPC, or transport layer.
- No large component system.
- No direct replacement for Elm.

## Design Records

- [0001: TypeScript TEA Runtime](docs/adr/0001-typescript-tea-runtime.md)
- [0002: Managed Effects and Subscriptions](docs/adr/0002-managed-effects-and-subscriptions.md)
- [0003: Strictness and Coverage](docs/adr/0003-strictness-and-coverage.md)
- [0004: Package Boundaries](docs/adr/0004-package-boundaries.md)
- [0005: DOM Patching Performance](docs/adr/0005-dom-patching-performance.md)
- [0006: Browserless Program Testing](docs/adr/0006-browserless-program-testing.md)
- [0007: Field Value Ownership After Mount](docs/adr/0007-field-value-ownership.md)
- [0008: WebMCP Uses Program Messages and Completion Effects](docs/adr/0008-webmcp-program-integration.md)

## Source ownership

The private Sports monorepo is Hypertea's editable source of truth. Public
copies are derived with filtered history and are not a second editable source.
Changes come back through this package.
