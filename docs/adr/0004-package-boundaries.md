# 0004: Package Boundaries

## Status

Accepted

## Decision

Hypertea lives as an independent package inside the private Sports monorepo at
`packages/hypertea`.

Host applications consume it through the root npm workspace while the interface
is still forming. A git submodule is not the integration mechanism.

## Package Shape

The package exports compiled JavaScript and declarations from `dist/`. The
declarations include Hypertea's global JSX namespace so consuming TSX islands do
not need local `jsx.d.ts` files.

Source code lives in `src/`. Tests may live next to source files when that improves locality, or in `test/` for public API and integration-style checks.

## Host Application Integration

Applications should depend on Hypertea through normal package tooling. They
should not copy runtime source files or JSX declarations into the app.

The canonical package remains private. It may be exported with filtered history
to a public showcase repository without making that repository a second source
of truth.
