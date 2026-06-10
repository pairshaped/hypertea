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

This repo is a scaffold. The runtime API is intentionally thin until the first real island forces the shape.

The current starting point includes:

- strict TypeScript config
- ESLint with side-effect guardrails
- Vitest with 100 percent coverage thresholds
- ADRs describing the intended design
- tiny initial helpers for exhaustive matching and empty effects

## Commands

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run check
```

`npm run check` is the command to run before handing work back.

## Intended API Shape

The target shape is TEA:

```ts
type Program<Model, Msg> = {
  init: () => readonly [Model, Effect<Msg>?]
  update: (message: Msg, model: Model) => readonly [Model, Effect<Msg>?]
  view: (model: Model) => View<Msg>
}
```

The exact view and mount APIs are still open. They should be designed from real Curling islands instead of guessed in advance.

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
