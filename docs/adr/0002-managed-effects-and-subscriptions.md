# 0002: Managed Effects and Subscriptions

## Status

Accepted

## Decision

Hypertea treats effects and subscriptions as managed runtime concepts.

Actions can return state directly or return `[state, ...effects]`. Each effect is either an effect function or an `[effect, payload]` tuple. The runtime runs effects after applying the state change and passes them `dispatch`.

Subscriptions are declared from state as `[subscriber, payload]` tuples. The runtime starts, preserves, restarts, and stops subscriptions as state changes. Payload changes restart a subscription unless the changed payload value is a function or an action tuple, matching Hyperapp's callback-preservation behavior.

Ordinary application code can request effects from actions, but it should not execute unmanaged browser or network side effects directly. Subscriptions use the same boundary: a subscription can listen to a browser or external event, but the behavior is declared through Hypertea and dispatches typed state transitions.

## Effect Boundary

Approved effect modules may touch browser APIs, network APIs, storage, time, randomness, and other external state.

Application modules should instead return effect values such as:

- HTTP requests
- delayed messages
- storage writes
- server-sent event subscriptions
- websocket subscriptions
- focus or DOM coordination when an island genuinely needs it

The exact constructors should be introduced when real islands need them.

## Lint Policy

Lint rules should reject direct side-effect APIs from ordinary source files. Exceptions should be narrow and documented in the ESLint config.

This is a safety decision, not a style preference.
