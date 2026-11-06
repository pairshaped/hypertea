# 0004: Package Boundaries

## Status

Accepted

## Decision

Hypertea is an independent TypeScript package. Host applications consume its
compiled exports through normal package tooling.

## Package Shape

The package exports compiled JavaScript and declarations from `dist/`. The
declarations include Hypertea's global JSX namespace so consuming TSX islands do
not need local `jsx.d.ts` files.

Source code lives in `src/`. Tests may live next to source files when that improves locality, or in `test/` for public API and integration-style checks.

## Host Application Integration

Applications should depend on Hypertea through normal package tooling. They
should not copy runtime source files or JSX declarations into the app.
