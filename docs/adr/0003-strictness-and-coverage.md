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

Strict TypeScript ESLint rules should also require explicit promise handling, explicit boolean checks, readonly-friendly code, and type-safe control flow.

## Exhaustiveness

Discriminated unions should use exhaustive `switch` statements or an approved pattern helper. The `assertNever` helper is part of the public safety surface.
