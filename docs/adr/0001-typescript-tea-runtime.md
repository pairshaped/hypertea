# 0001: TypeScript TEA Runtime

## Status

Accepted

## Decision

Hypertea is a project-owned TypeScript runtime for small client islands using The Elm Architecture.

The runtime centers on:

- `Model`: immutable island state
- `Msg`: discriminated-union messages
- `Effect`: page-local effect values returned by `update`
- `Program`: the canonical typed island definition shared by production and tests
- `defineProgram`: compile-time validation for the program definition
- `mountProgram`: flags and host element binding for a canonical program
- `start`: lower-level runtime bootstrapping, message dispatch, effect execution, and subscription patching
- `h`, `fragment`, `text`, and `memo`: virtual DOM construction
- JSX types for TSX island views
- event helpers such as `clicked`, `inputChanged`, `checkedChanged`, and `submitted`
- browser subscription helpers such as `every`, `keyPressed`, and `windowResized`

The public API should make the normal path safe and boring. Application code should not import browser APIs directly to perform effects.

The runtime owns the DOM mechanics. It may use browser APIs internally to create nodes, attach event listeners, patch keyed children, and reconcile server-rendered nodes.

The lower-level `app` API exists for the runtime and benchmarks. Application islands should define one `Program` and mount it with `mountProgram` or `mountIslands`.

## Design Constraints

- Keep the runtime small enough to understand in one sitting.
- Prefer explicit types over clever inference when that improves agent reliability.
- Keep the runtime friendly to SSR islands.
- Avoid SPA router concerns.
- Avoid dependencies unless they clearly reduce risk.

## Acceptance Criteria

- Application updates are pure.
- Effects are represented as typed page-local values returned from `update`.
- Exhaustive message handling is easy to enforce.
- Island bootstrapping accepts server-rendered flags.
- The package stays useful without a build-time framework plugin.
