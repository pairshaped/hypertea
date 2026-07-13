# 0003: Strictness and Coverage

## Status

Accepted

## Decision

Hypertea uses strict TypeScript, strict linting, and 100 percent test coverage thresholds.

The package exists to give agents and humans a narrow, safe client-side path. Weak test and lint settings would defeat the point.

The ESLint configuration is a first-class design tool. It is used to enforce Elm-like guardrails around side effects, promise handling, boolean checks, mutation, and exhaustiveness.

## TypeScript

The TypeScript config enables strictness settings that catch common runtime mistakes:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noImplicitReturns`

## Tests

Vitest coverage thresholds are 100 percent for:

- statements
- branches
- functions
- lines

New runtime behavior should be written with tests first or alongside the implementation.

## ESLint

ESLint should reject unmanaged side effects in ordinary source files. Restricted APIs include browser globals, storage, timers, `fetch`, randomness, and wall-clock APIs.

Approved runtime effect and subscription modules may touch those APIs. Application code should request managed effects instead.

Hypertea exposes `hyperteaPurity()` from `@pairshaped/hypertea/eslint` so
applications can apply the same restriction to ordinary helper and domain
modules. Applications pass the files covered by the boundary and an explicit
`effectFiles` exception list. Each exception is an effect adapter or integration
entry point whose side effects are intentional and documented beside the lint
configuration.

An application entry module may receive a small documented `allowedGlobals`
list when it owns mount or effect-runner plumbing. The exception applies only to
that file group. Application-specific syntax restrictions are appended through
`extraRestrictedSyntax` so flat config merging cannot silently replace the
shared side-effect selectors.

The shared rule covers direct globals, common `globalThis` access, DOM event
listeners, wall-clock time, and randomness. A narrow inline disable is allowed
when it includes a concrete reason. Broad directory-level disables are not part
of the design.

This lint boundary does not perform call-graph analysis or prove third-party
code pure. Its job is to make accidental unmanaged effects difficult and make
intentional exceptions visible during review.

Strict TypeScript ESLint rules should also require explicit promise handling, explicit boolean checks, readonly-friendly code, and type-safe control flow.

## Exhaustiveness

Discriminated unions should use exhaustive `switch` statements or an approved pattern helper. The `assertNever` helper is part of the public safety surface.
