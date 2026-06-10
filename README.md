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

The runtime now follows Hyperapp's small API shape:

- `app()` for state, rendering, effects, subscriptions, and dispatch
- `h()` for element VNodes
- `typedH()` for state-aware view helpers
- `text()` for text VNodes
- `memo()` for memoized view islands
- action functions and direct state dispatches
- effect functions and `[effect, payload]` tuples
- subscription functions and `[subscriber, payload]` tuples
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
```

`npm run check` is the command to run before handing work back.

## API Shape

Hypertea is intentionally close to Hyperapp:

```ts
import { app, text, typedH, type Action } from "@pairshaped/hypertea"

type State = {
  readonly count: number
}

const Increment: Action<State> = (state) => ({
  count: state.count + 1,
})

const h = typedH<State>()
const node = document.querySelector("#counter")

if (node === null) {
  throw new Error("Missing #counter mount node")
}

app<State>({
  init: { count: 0 },
  view: (state) =>
    h("button", { onclick: Increment }, text(String(state.count))),
  node,
})
```

Actions may return state directly or a tuple of `[state, ...effects]`. Effects and subscriptions are managed by the runtime so ordinary island code can stay focused on state transitions.

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
