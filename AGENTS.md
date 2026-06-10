# Agent Notes

Use radical candor. If a design choice weakens Elm-like safety, say so plainly.

This package is intentionally small. Do not add framework-shaped machinery unless the tests and README make the need obvious.

Run `npm run check` before claiming the project is healthy.

## Boundaries

- Runtime code lives in `src/`.
- Tests live next to the behavior they protect or in `test/` when the test is broader than one file.
- ADRs live in `docs/adr/`.
- Public API changes should update `README.md` and the ADRs when the design decision changes.

## Safety Rules

- Keep side effects behind typed effect/subscription APIs.
- Do not call `fetch`, timers, browser globals, storage, randomness, or wall-clock time from ordinary runtime code.
- Preserve exhaustive message handling through discriminated unions and `assertNever`.
- Keep coverage at 100 percent for statements, branches, functions, and lines.
- Avoid `null`; model absence with `undefined` only when it is clearly an optional property, or with an explicit union when it is domain state.

## Writing

Write like a person. No em dashes. Avoid promotional or stock AI phrasing.
