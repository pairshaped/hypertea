# WebMCP Uses Program Messages and Completion Effects

WebMCP is an optional browser input adapter exported from
`@pairshaped/hypertea/webmcp`. It registers tools through a managed subscription
and maps validated inputs to ordinary typed application intent messages. The
application uses its existing update and effect path, carrying an optional
invocation ID to an explicit `webmcp.complete` effect. Render settlement alone
cannot establish that an asynchronous operation succeeded.

The bridge keeps promises outside the model, correlates each completion, waits
for rendering before replying, and owns registration teardown. Applications own
tool metadata, validation, business outcomes and result projections. Removing
the subscription cancels pending callers. Cancellation after dispatch means the
caller does not know the outcome; it does not roll back application work.

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
tools. Native and JavaScript calls share validation, completion correlation,
render settlement and cancellation semantics.

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
