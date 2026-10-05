# 0002: Managed Effects and Subscriptions

## Status

Accepted

## Decision

Hypertea treats effects and subscriptions as managed runtime concepts.

`update(model, message, origin)` returns `[model, effects]`. `origin` is
`native` or `fallback` on an attributed call chain and `undefined` on a human,
initialization or plain subscription chain. It conveys provenance, never authority.

Application effects are page-local values interpreted by `runEffect`. Each runner
receives a dispatch bound to its own chain. It must return a promise that settles
after its last dispatch. Pass that dispatch through unchanged so asynchronous
continuations retain their caller and origin.

`reply(result)` is a runtime-owned transition value. It answers the caller on that
chain and never reaches `runEffect`. A human chain's reply is dropped. The first
reply wins, is secured before subscription teardown, and flushes the queued DOM
render before the transition's effects run. A stale response replies from its own
chain; a newer operation cannot answer it.

`call(message, { origin, signal })` is available on the program handle and each
subscription context. An already-aborted signal rejects with
`cancelled-before-dispatch`; cancellation after dispatch, program stop, subscription
withdrawal and a chain ending without a reply reject with `unknown`. Cancelling a
call does not cancel its effects. Late replies are ignored.

Subscriptions are declared from model state as `ProgramSubscription<Msg>` values.
The runtime preserves or replaces instances as state changes. Calls belong to the
issuing instance, so replacing it rejects its pending calls.

`ProgramContext.settle()` and the handle's `settle()` flush queued rendering without
waiting for an animation frame. They do not wait for network requests or effects.
Hidden tabs therefore retain the same reply and DOM ordering as visible tabs.

Ordinary application code can request effects from `update`, but it should not execute unmanaged browser or network side effects directly. Subscriptions use the same boundary: a subscription can listen to a browser or external event, but the behavior is declared through Hypertea and dispatches typed messages.

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


## Document state subscriptions

The optional `page-state` effect module owns a versioned document registry and a
read-only discovery port. Separately bundled mounts share this registry and one
unload listener. Every registration has its own lifetime and current projection;
stopping it removes only its cards and protection. Unavailable state is distinct
from a clean draft.

Mount ownership and projection publication use separate fixed subscription slots.
The publication includes its immutable projection as a non-function payload.
Subscriptions reconcile synchronously after the next model is installed, before
dispatch returns, even when rendering is queued. Reads and unload protection
therefore reflect the current model without awaiting renderer settlement. Child
subscription positions stay stable so this publication cannot withdraw tool calls.

A pending card has an opaque mount-scoped handle, feature token, scope and material
revision. Human decisions consume the handle and enter the target's ordinary
subscription dispatch. The target Program rejects attributed origins and checks
its latest model identity, token, eligibility and material revision before choosing
its canonical message. An unrelated pending tool call keeps its original caller
and response; the human decision cannot answer it.
