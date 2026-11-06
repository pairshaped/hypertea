# 0005: DOM Patching Performance

## Status

Accepted

## Decision

Hypertea should keep its DOM patcher close to Hyperapp's performance model while preserving TypeScript readability and the runtime's Elm-like boundaries.

The child patcher should optimize for the update shapes that small SSR islands hit most often:

- unchanged child references
- text updates
- matching keyed prefixes
- matching keyed suffixes
- append-only child lists
- remove-only child lists
- small keyed reorders

The runtime should use head and tail scans before allocating keyed lookup structures. It should allocate maps only for the unmatched middle of a child list, where keyed movement or insertion actually needs lookup.

For keyed middle patches, Hypertea should use the same head-walking shape as Hyperapp: track keyed old children, walk the old and new middle once, move known keyed DOM nodes into place, and remove stale keyed nodes after the walk. This keeps reverse and move-heavy keyed updates in Hyperapp's neighbourhood without adding public API or framework machinery.

## VNode ownership

Each mounted VNode occurrence owns its DOM node and mutable child slots. A view
may place one VNode value in several positions. When an incoming VNode already
belongs to another mounted occurrence, the patcher copies it and its child array
before mounting or patching that position. Descendants acquire their own copies
as the patcher visits them. Props remain shared because patching does not mutate
them. Reusing the VNode at its existing occurrence keeps the identity fast path,
including memoized views and keyed moves.

Views should build separate VNodes for separate desktop and mobile projections.
Runtime ownership also protects callers that reuse a subtree. It does not repair
DOM changes made outside Hypertea, such as browser extensions moving text nodes.

## Conditional children and hydration

Absent children (`undefined`, `null`, `false` and `true`) occupy empty text
slots. A conditional element can appear and disappear in its slot without
shifting a later input into a different position. Nested fragments preserve
these slots too. Empty text contributes no text content or layout box.

HTML parsing drops empty text and merges adjacent text. Recycled element VNodes
therefore use a first-patch hydration pass. It preserves a matching suffix of element tags, then restores missing empty
slots and splits matching text runs while walking the remaining server nodes
in order. The suffix anchors insertion when fallback markup has fewer children
than the client view. Matching elements are patched in place. Once hydrated, the element uses ordinary keyed or unkeyed
reconciliation. A private weak set marks recycled VNodes, with no public VNode,
child type or `h` signature change. Server and client must still agree on the
visible element structure; this does not infer missing server elements or repair
arbitrary mismatched markup without replacement.

Comment placeholders would require every server renderer to emit matching
comments, or require the same first-patch alignment. They also need another node
kind in the patcher. Requiring keys would push conditional-slot correctness into
every caller and would not fix existing unkeyed views. Empty text slots with
hydration keep the correction at the runtime boundary.

The runtime tests toggle each absent-child kind around a focused input and check
identity, typed value and selection through repeated updates. A MutationObserver
fixture hydrates absent slots around adjacent text, a memoized subtree and a keyed
sibling, asserting zero removed elements and preserved focus. Existing keyed
reorder tests continue to cover subsequent reconciliation.

## Performance Goal

Hypertea does not need to beat Hyperapp. It should stay within the same practical class for small SSR islands:

- one render per animation frame
- linear child reconciliation for normal append, remove, and same-order updates
- no keyed map allocation for common prefix, suffix, append-only, or remove-only updates
- DOM node reuse for keyed moves
- no public API expansion solely for performance

Benchmarks should be introduced before claiming parity. Until then, "fast like Hyperapp" means the patcher follows the same algorithmic shape and avoids obvious extra allocations on common paths.

Use the benchmark suite to track regressions. Its jsdom results do not establish browser performance or hydration parity.

## Benchmarking

The package includes a jsdom benchmark suite:

```sh
pnpm run bench
```

The suite compares Hypertea to Hyperapp on text updates, static-shape rerenders, form property/style updates, class-heavy forms, append/remove keyed rows, keyed middle moves, keyed reversals, mixed contact-row lists, memoized children, recycled SSR rows, event dispatch, and subscription preserve/restart paths.

Jsdom timings are not browser timings. They are useful for measuring relative changes in this repo and for spotting regressions before testing in a real browser.

## Constraints

- Keep the runtime small enough to read in one sitting.
- Keep side effects contained inside the runtime and approved effect/subscription boundaries.
- Preserve existing public APIs and host application integration.
- Preserve 100 percent statement, branch, function, and line coverage.
- Prefer clear local helper functions over a minified port when TypeScript needs help.

## Acceptance Criteria

- Prefix and suffix keyed children patch without building keyed maps.
- Append-only and remove-only child updates patch linearly.
- Keyed middle reorders reuse existing DOM nodes.
- Keyed reverse and move-heavy benchmarks remain in Hyperapp's performance neighbourhood.
- The normal project check passes.
