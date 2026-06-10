# 0001: TypeScript TEA Runtime

## Status

Accepted

## Decision

Hypertea is a project-owned TypeScript runtime for small client islands using The Elm Architecture.

The runtime centers on:

- `Model`: immutable island state
- `Msg`: discriminated-union messages
- `init`: initial state plus optional startup effect
- `update`: pure state transition plus optional effect
- `view`: typed view output
- `mount`: island bootstrapping from server-provided flags

The public API should make the normal path safe and boring. Application code should not import browser APIs directly to perform effects.

## Design Constraints

- Keep the runtime small enough to understand in one sitting.
- Prefer explicit types over clever inference when that improves agent reliability.
- Keep the runtime friendly to SSR islands.
- Avoid SPA router concerns.
- Avoid dependencies unless they clearly reduce risk.

## Acceptance Criteria

- Application updates are pure.
- Effects are represented as typed values or approved managed functions.
- Exhaustive message handling is easy to enforce.
- Island bootstrapping accepts server-rendered flags.
- The package stays useful without a build-time framework plugin.
