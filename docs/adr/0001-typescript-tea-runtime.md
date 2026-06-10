# 0001: TypeScript TEA Runtime

## Status

Accepted

## Decision

Hypertea is a project-owned TypeScript runtime for small client islands using The Elm Architecture with a Hyperapp-shaped API.

The runtime centers on:

- `State`: immutable island state
- `Action`: a state transition function
- `Dispatchable`: state, action, action payload tuple, or state plus effects tuple
- `Effect`: a managed effect function or `[effect, payload]` tuple
- `Subscription`: a managed subscriber plus payload tuple
- `app`: island bootstrapping, dispatch, subscription patching, and DOM patching
- `h`, `typedH`, `text`, and `memo`: virtual DOM construction

The public API should make the normal path safe and boring. Application code should not import browser APIs directly to perform effects.

The runtime owns the DOM mechanics. It may use browser APIs internally to create nodes, attach event listeners, patch keyed children, and reconcile server-rendered nodes.

Apps can use `typedH<State>()` to create a state-aware `h` helper and avoid repeating the state generic in every view call.

## Design Constraints

- Keep the runtime small enough to understand in one sitting.
- Prefer explicit types over clever inference when that improves agent reliability.
- Keep the runtime friendly to SSR islands.
- Avoid SPA router concerns.
- Avoid dependencies unless they clearly reduce risk.

## Acceptance Criteria

- Application updates are pure.
- Effects are represented as typed managed functions or effect tuples.
- Exhaustive message handling is easy to enforce.
- Island bootstrapping accepts server-rendered flags.
- The package stays useful without a build-time framework plugin.
