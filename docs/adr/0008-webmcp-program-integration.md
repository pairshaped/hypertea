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

Ordinary program imports do not load the adapter. The browserless suite tests
program behavior through the public interfaces. A separate, opt-in native smoke
test verifies the browser's evolving WebMCP contract. This browser boundary
cannot be proved in JSDOM: Chrome 152 omits the execution-options argument in the
current draft, despite exposing the current registration interface. Keep native
compatibility checks outside the default suite and record exact versions and
limitations in the [integration guide](../webmcp.md).
