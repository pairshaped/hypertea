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
- Rust application tests cover authorization, persistence, transactions, server validation, and generated transport contracts.
- Manual browser checks cover CSS layout, pointer geometry, native drag behavior, focus quirks, and other behavior that JSDOM cannot prove.

The default automated suite does not install or start Playwright, Chromium, or another
browser. State transitions, validation, rendering, keyboard behavior, effect
ordering, and stale response handling belong in Node or JSDOM tests. A test that
starts a browser for behavior those layers can prove is at the wrong boundary.

Native drag-and-drop is an accepted manual boundary. Reducer tests prove the
drag messages and resulting state transitions. Interaction tests prove any
rendered state before and after those messages. Manual checks prove that the
browser and drag adapter produce the expected messages from a physical drag,
that drop targets follow the pointer, and that previews and connectors line up.
We accept that this boundary has less automated coverage because browser drag
automation adds more installation and maintenance cost than the risk warrants.

When browser-specific code, drag adapters, or affected layout changes, manually
check the changed path in a supported browser. Keep that check short and
feature-specific. Adding an automated browser runner requires a new design
decision backed by a concrete regression that cannot be represented through the
production `Program` in Node or JSDOM.

Every complex island exports its canonical program. A separate test-only program definition is not allowed because it can drift from production behavior.

The optional native WebMCP smoke test is the exception recorded in
[0008: WebMCP Uses Program Messages and Completion Effects](0008-webmcp-program-integration.md).
It proves browser registration, invocation and cleanup that JSDOM cannot
implement. Application behavior remains in the default browserless suite.
