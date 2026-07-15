# 0006: Browserless Program Testing

## Status

Accepted

## Decision

Production code and interaction tests mount the same canonical `Program` object. A program owns `init`, `update`, `view`, and subscriptions. The host owns flags, the mount element, and the effect interpreter.

`mountProgram` and `start` return a typed handle with four operations:

- `model()` reads the current model synchronously.
- `dispatch(message)` sends a typed message through the production update loop.
- `settle()` waits for the currently queued DOM render.
- `stop()` removes active subscriptions and ignores later dispatches. Calling it more than once has no additional effect.

`settle()` does not wait for effects, timers, animation, or network requests. Tests control those boundaries explicitly and dispatch completion messages themselves.

The `@pairshaped/hypertea/testing` entry point exposes program mounting without importing JSDOM or creating global browser state. The caller provides the DOM environment. Its mount captures effects instead of running the production interpreter. `effects()` returns a frozen pending-effect snapshot, and `takeEffect(index)` consumes one pending effect. Each pending value exposes only the typed effect and a typed message dispatcher. Tests can therefore complete concurrent effects in any order without network or timer work.

Hypertea does not provide its own selector, event, or assertion language.

## Test Boundaries

- Reducer tests run in Node and assert model transitions and effect values.
- Interaction tests run in JSDOM with Vitest, Testing Library, and user-event. They exercise the production view, event bindings, subscriptions, and update loop.
- Browser tests cover layout, pointer geometry, native drag behavior, and browser-specific behavior that JSDOM cannot prove.

Every complex island exports its canonical program. A separate test-only program definition is not allowed because it can drift from production behavior.
