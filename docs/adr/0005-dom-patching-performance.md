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

## Performance Goal

Hypertea does not need to beat Hyperapp. It should stay within the same practical class for Curling-style islands:

- one render per animation frame
- linear child reconciliation for normal append, remove, and same-order updates
- no keyed map allocation for common prefix, suffix, append-only, or remove-only updates
- DOM node reuse for keyed moves
- no public API expansion solely for performance

Benchmarks should be introduced before claiming parity. Until then, "fast like Hyperapp" means the patcher follows the same algorithmic shape and avoids obvious extra allocations on common paths.

The current target is practical parity, not winning every row. A benchmark result is acceptable when most scenarios are near Hyperapp and no Curling-shaped island path is wildly slower. Current jsdom runs put Hypertea faster on simple text, static, form, append/remove, SSR recycle, click dispatch, and subscription restart paths, with keyed middle and mixed row reorders still close enough to track rather than block.

## Benchmarking

The package includes a jsdom benchmark suite:

```sh
npm run bench
```

The suite compares Hypertea to Hyperapp on text updates, static-shape rerenders, form property/style updates, class-heavy forms, append/remove keyed rows, keyed middle moves, keyed reversals, mixed contact-row lists, memoized children, recycled SSR rows, event dispatch, and subscription preserve/restart paths.

Jsdom timings are not browser timings. They are useful for measuring relative changes in this repo and for spotting regressions before testing in a real browser.

## Constraints

- Keep the runtime small enough to read in one sitting.
- Keep side effects contained inside the runtime and approved effect/subscription boundaries.
- Preserve existing public APIs and Curling integration.
- Preserve 100 percent statement, branch, function, and line coverage.
- Prefer clear local helper functions over a minified port when TypeScript needs help.

## Acceptance Criteria

- Prefix and suffix keyed children patch without building keyed maps.
- Append-only and remove-only child updates patch linearly.
- Keyed middle reorders reuse existing DOM nodes.
- Keyed reverse and move-heavy benchmarks remain in Hyperapp's performance neighbourhood.
- The normal project check passes.
