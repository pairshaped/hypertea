# WebMCP uses program calls and replies

WebMCP is an optional browser input adapter exported from
`@pairshaped/hypertea/webmcp`. It registers tools through a managed subscription
and maps validated inputs to ordinary typed application intent messages. The
adapter runs each admitted message with `context.call(message, { origin, signal, caller })`.
The application returns `reply(result)` from its update. Hypertea routes that reply
through the effect dispatch continuation, flushes rendering without waiting for a
frame, and settles the call before starting the transition's effects.

The runtime owns waiting calls and their lifetimes. Applications own tool
descriptions, annotations, business validation, outcomes and result projections.
`exposeMessages<Msg>` takes an explicit array of `{ message, description }`
entries, with optional title and annotations, and returns `mcpTools`. Names are
checked against the existing message union; duplicate entries are rejected.
Exposure stays outside message payloads: no `mcp` field or custom annotation is
required. Build-time
TypeScript inspection generates their JSON input schemas; the runtime validates
against the same schemas and maps inputs to program calls. The
compiler stays outside browser imports. Builds check the committed sidecar for
drift. Unsupported types fail generation rather than widening the contract.
Message unions stay organized by application behavior, not by caller type.

Generation preserves optional properties and union alternatives and excludes the
root discriminator. Selected messages need no completion metadata. It does not
infer business rules or outcomes. The manual `defineWebMCPTool` adapter is available
when a different tool contract or unsupported payload type needs explicit parsing.

Pure input parsing and message mapping run before observer admission and the
Program call. A failure rejects with `WebMCPInvocationError`, outcome
`cancelled-before-dispatch` and the constrained reason `invalid-input`. The
message is fixed; parser exceptions and rejected data are not projected to the
caller. The adapter catches only this mapping boundary. Errors after the Program
call retain cancellation or unknown semantics and do not carry this reason.
A caller can record the known refusal through its normal result protocol.

A scoped caller first checks its lifetime, abort signal and captured catalog.
Only a still-current catalog can reject an absent name with reason `unknown-tool`
and outcome `cancelled-before-dispatch`. This happens before mapping, observers
or Program dispatch. The fixed error message contains no input or requested name.
A built-in caller may return the already-offered captured tool names with this
known refusal. Changed catalogs and ordinary cancellations carry no reason;
unknown outcomes discard both refusal reasons. Global fallback name lookup and
native registration keep their existing behavior.


Removing a subscription or replacing its tools array rejects pending calls with
`unknown`. An already-aborted signal rejects with `cancelled-before-dispatch`.
Cancellation after dispatch retires the invocation and suppresses late message
continuations. It does not roll back already-sent work. The first reply wins;
duplicate terminal dispatches are ignored. A chain that ends without a reply rejects with
`unknown`. Runners must return promises that settle after their last dispatch.

Each subscription publishes the same execution callbacks through native
`document.modelContext` when present and a page-level JavaScript interface,
`window.hyperteaAgent`, with an inert JSON catalog. No application transport
switch or query parameter is required. The JavaScript interface lists metadata
and executes declared tools by name. It does not expose arbitrary dispatch or
pretend to supply browser-managed permissions or agent discovery.

Multiple mounted programs share the page catalog, with unique names and
independent ownership of their registrations. Removing a program's tool set
updates discovery and cancels its callers. Removing the last set removes the
global and catalog. A registration failure removes only the failing bridge's
tools. Native and JavaScript calls share validation, caller routing,
render settlement and cancellation semantics.

Publication and call observers are stored on the owning document with stable
versioned symbols. Independently bundled shell and feature programs share one
catalog and keep independent registration ownership. Document-scoped observers
can refuse a validated call synchronously before dispatch. Start notifications
run only after admission and before dispatch, on both native and fallback paths.
Human message dispatch does not pass through this adapter boundary.

Built-in callers use the same registry through an invocation-scoped handle.
Observers receive that opaque handle alongside tool metadata. A page may exempt
its own caller from its busy guard; feature validation, tool-origin restrictions
and other observers still apply. Each turn captures the current registrations.
Any catalog replacement invalidates that capture before its next dispatch.
Caller detachment cancels waiting without replaying or undoing application work.

The adapter supplies native or fallback origin in its program call.
The runtime keeps it on each effect's dispatch function and carries it into
messages that function sends. `effectOrigin(dispatch)` exposes this attribution
to effect runners without adding it to domain messages or models. `effectInvocation(dispatch)` exposes a frozen per-call context with the opaque
caller handle, original origin, cancellation signal and `isLive()` check. Every
continuation shares that identity. A terminal reply retires liveness; cancellation,
failed completion and owner retirement also abort its signal. Effects scheduled
alongside a successful reply retain provenance but cannot issue further correlated
messages. External effects must check liveness before a delayed business send.
Human and initial effects have no invocation or agent origin. Origin never grants authority. Stable
symbols let independently bundled adapters and effect runners share the value;
no document-wide active-call flag controls attribution.

Ordinary program imports do not load the adapter. The browserless suite tests
program behavior through the public interfaces. A separate, opt-in native smoke
test verifies the browser's evolving WebMCP contract. This browser boundary
cannot be proved in JSDOM: Chrome 152 omits the execution-options argument in the
current draft, despite exposing the current registration interface. Keep native
compatibility checks outside the default suite and record exact versions and
limitations in the [integration guide](../webmcp.md).

The browser smoke test also has a mode that disables native WebMCP and invokes
the same example through page JavaScript. Browser configuration owns that
test-only distinction; the example publishes both interfaces unconditionally.
