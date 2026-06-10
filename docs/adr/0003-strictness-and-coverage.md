# 0003: Strictness and Coverage

## Status

Accepted

## Decision

Hypertea uses strict TypeScript, strict linting, and 100 percent test coverage thresholds.

The package exists to give agents and humans a narrow, safe client-side path. Weak test and lint settings would defeat the point.

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

## Exhaustiveness

Discriminated unions should use exhaustive `switch` statements or an approved pattern helper. The `assertNever` helper is part of the public safety surface.
