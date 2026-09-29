# WebMCP Uses Program Messages and Completion Effects

WebMCP is an optional browser input adapter exported from
`@pairshaped/hypertea/webmcp`. It registers tools through a managed subscription
and maps validated inputs to ordinary typed application intent messages. The
application uses its existing update and effect path, carrying an optional
invocation ID to an explicit `webmcp.complete` effect. Render settlement alone
cannot establish that an asynchronous operation succeeded.

The bridge keeps promises outside the model, correlates each completion, waits
for rendering before replying, and owns registration teardown. Applications own
tool descriptions, annotations, business validation, outcomes and result projections.
`exposeMessages<Msg>` takes an explicit array of `{ message, description }`
entries, with optional title and annotations, and returns `mcpTools`. Names are
checked against the existing message union; duplicate entries are rejected.
Exposure stays outside message payloads: no `mcp` field or custom annotation is
required. Build-time
TypeScript inspection generates their JSON input schemas; the runtime validates
against the same schemas and supplies dispatch and invocation mapping. The
compiler stays outside browser imports. Builds check the committed sidecar for
drift. Unsupported types fail generation rather than widening the contract.
Message unions stay organized by application behavior, not by caller type.

Generation preserves optional properties and union alternatives, excludes the
root discriminator and invocation ID, and requires an explicit completion field
on selected messages. It does not infer business rules or outcomes. The manual
`defineWebMCPTool` adapter is available when a deliberately different tool
contract or unsupported payload type calls for explicit parsing and mapping.
 Removing
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
