# 0002: Managed Effects and Subscriptions

## Status

Accepted

## Decision

Hypertea treats effects and subscriptions as managed runtime concepts.

Ordinary application code can request effects from `update`, but it should not execute unmanaged browser or network side effects directly. Subscriptions use the same boundary: a subscription can listen to a browser or external event, but the behavior is declared through Hypertea and produces `Msg` values.

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
