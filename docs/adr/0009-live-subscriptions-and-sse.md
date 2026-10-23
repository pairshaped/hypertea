# 0009: Live subscriptions and SSE

## Status

Accepted

## Decision

`@pairshaped/hypertea/live` exposes `liveSubscription`, `eventStream` and `readSse`.
The module owns external effects behind `ProgramSubscription<Msg>`. Importing the
main runtime does not pull it in. There is no shared mount state.

The core accepts a transport `open(cursor, signal, opened)` that yields raw
records for one connection attempt. The decoder validates each record and returns
a message and optional cursor. The core retains an omitted cursor and stores a
returned cursor exactly. Monotonicity, deduplication and terminal messages belong
to the application. A rejected record never advances the cursor.

The public program subscription list accepts `false` for an empty fixed slot.
The adapter preserves that value for the positional subscription reconciler.
Disabling an earlier subscription therefore does not move or restart a later one.
Matching remains positional and compares the key within the slot. A live key
names the resource and any stable baseline, never its changing cursor. Captured
options remain fixed until that slot's key changes or the subscription is removed.

Startup waits one microtask before calling the transport. A transport can call
`opened()` synchronously, dispatching a connected or health message. Without the
deferral, that dispatch re-enters reconciliation before the runtime has installed
the subscription, recursively starting it again. Disposal before the microtask
prevents the transport from opening or dispatching anything.

## Lifetime and retry

Every mount owns an abort controller per attempt and at most one retry timer.
Disposal aborts the current attempt, cancels its retry and blocks later dispatch,
including a decode callback that disposes the subscription before returning.
Applications end a stream by returning `false` in its slot. The core has no
terminal message or attempt limit.

Retry delay grows from `initialMs` by `factor` (default 2), capped at `maxMs`.
`resetOn` selects healthy open or accepted message. Resetting on a message keeps
a server that opens and immediately closes from holding the delay at its minimum.
A clean stream end is an unexpected disconnection and retries like a failure.
Invalid policies fail at construction rather than producing a hot retry loop.

Health messages are deduplicated by kind and problem text. A quiet connection is
healthy as soon as it opens. Connected messages occur once per healthy open;
disconnected messages occur once per transition to unhealthy, including failure
before the first open. Errors retain their identity through the core. Disposal
is not reported as an error. Callbacks other than `decode` are expected to return
normally; they should not throw.

## SSE boundary

The transport uses streaming fetch to support headers, credentials, failure
classification and a record size cap. Fetch owns one attempt; the core owns
reconnect timing. Server `retry:` fields do not change that timing.

A cursor can use `Last-Event-ID` or a caller-named query parameter. The latter
avoids a custom header for cross-origin streams. Without caller headers the only
header is `Accept: text/event-stream`. Requests use `cache: "no-store"` and
`credentials: "same-origin"` by default; callers can choose `"omit"`.

The parser handles CR, LF and CRLF, holds a trailing CR until the next chunk or
EOF, and decodes UTF-8 fatally. Multiline data is joined with newlines. Comments,
unknown fields and NUL-containing ids are ignored. Only complete records with a
data field are emitted. Event names default to `message`. An incomplete trailing
record is discarded, but invalid or truncated UTF-8 still fails the connection.

The cap defaults to 1048576 raw bytes per record. It counts field names, comments,
line endings and a leading BOM, including bytes the decoder has not yet turned
into text. Oversized records fail before delivery. Framing scans bytes once and
decodes bounded segments, so fragmented long lines do not require repeatedly
re-encoding all pending text. Replays should use one bounded record per update.
Readers are canceled and their locks released on completion, failure and abort.

Credential rejection, other HTTP status failures, wrong content types and fetch
network failures receive neutral error text. Only a `TypeError` originating from
fetch is classified as a network failure. `describeError` customizes transport
wording; decoder exceptions pass through unchanged.

Fetch, timers and TextDecoder have injectable implementations with real defaults.
Tests use fake transports, fetch responses, timers and direct microtask progression.
They prove parser boundaries, cursor acceptance, connection transitions, disposal,
independent mounts and fixed-slot Program integration without a real server or
wall-clock waits. SSE is the only provided transport; existing socket APIs remain
separate.
