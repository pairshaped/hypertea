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

## Status

The runtime has two layers:

- `start()` for Elm-like island programs with `Model`, `Msg`, `Effect`, `init`, `update`, `view`, and `subscriptions`
- `h()` and `fragment()` for TSX-friendly element VNodes
- package-provided JSX types for TSX islands
- `text()` for text VNodes
- `memo()` for memoized view islands
- event helpers such as `clicked`, `inputChanged`, `checkedChanged`, and `submitted`
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

## Commands

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run check
npm run bench
```

`npm run check` is the command to run before handing work back.

`npm run bench` builds Hypertea and compares its DOM patching against Hyperapp in jsdom. Treat the numbers as regression signals and optimization guidance, not browser parity proof.

## API Shape

Application islands should use `start()`:

```ts
import { clicked, h, start, type Runtime, type VNode } from "@pairshaped/hypertea"

type Model = {
  readonly count: number
}

type Msg = { readonly type: "increment" }
type Effect = never

const node = document.querySelector("#counter")

if (node === null) {
  throw new Error("Missing #counter mount node")
}

const runtime: Runtime<Model, Msg, Effect> = {
  init: () => [{ count: 0 }, []],
  update: (model, message) => {
    switch (message.type) {
      case "increment":
        return [{ count: model.count + 1 }, []]
    }
  },
  view: (model): VNode<Model> =>
    h("button", { onClick: clicked({ type: "increment" }) }, String(model.count)),
  runEffect: () => undefined,
  node,
}

start(runtime)
```

`update` returns `[model, effects]`. Effects and subscriptions are managed by the runtime so ordinary island code can stay focused on state transitions.

The lower-level `app()` API remains available for runtime internals and benchmarks. Application code should prefer `start()`.

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
