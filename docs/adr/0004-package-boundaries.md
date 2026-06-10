# 0004: Package Boundaries

## Status

Accepted

## Decision

Hypertea lives as a standalone TypeScript project at `/Users/daverapin/projects/ts/hypertea`.

The Curling Rust app can consume it through a local package link while the API is still forming. A git submodule is not the default integration mechanism.

## Package Shape

The package exports compiled JavaScript and declarations from `dist/`.

Source code lives in `src/`. Tests may live next to source files when that improves locality, or in `test/` for public API and integration-style checks.

## Curling Integration

The Curling app should depend on Hypertea through normal package tooling. It should not copy runtime source files into the app.

While the package is private, local development can use a `file:` dependency or package link. Publishing can be considered later if more projects need it.
