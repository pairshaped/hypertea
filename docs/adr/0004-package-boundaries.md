# 0004: Package Boundaries

## Status

Accepted

## Decision

Hypertea lives as a standalone TypeScript project at `/Users/daverapin/projects/ts/hypertea`.

Host applications can consume it through a local package link while the API is still forming. A git submodule is not the default integration mechanism.

## Package Shape

The package exports compiled JavaScript and declarations from `dist/`. The
declarations include Hypertea's global JSX namespace so consuming TSX islands do
not need local `jsx.d.ts` files.

Source code lives in `src/`. Tests may live next to source files when that improves locality, or in `test/` for public API and integration-style checks.

## Host Application Integration

Applications should depend on Hypertea through normal package tooling. They
should not copy runtime source files or JSX declarations into the app.

While the package is private, local development can use a `file:` dependency or package link. Publishing can be considered later if more projects need it.
