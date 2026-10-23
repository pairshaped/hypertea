// @vitest-environment node
import { expect, test, vi } from "vitest";
import { readSse, eventStream, liveSubscription, type LiveTransport, type LiveHealth } from "./live.js";

function body(parts: Array<Uint8Array>) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    }
  });
}
const encode = (text: string) => new TextEncoder().encode(text);
async function collect(stream: AsyncIterable<unknown>) {
  const records: Array<unknown> = [];
  for await (const record of stream) records.push(record);
  return records;
}

test("fragmented UTF-8 and CRLF preserve multiline data; incomplete records are discarded", async () => {
  const bytes = encode(": heartbeat\r\nid: 1\r\nevent: update\r\ndata: café\r\ndata: second\r\n\r\nid: 2\ndata: partial");
  const decoder = vi.fn(function(...args: ConstructorParameters<typeof TextDecoder>) { return new TextDecoder(...args); });
  expect(await collect(readSse(body(Array.from(bytes, byte => Uint8Array.of(byte))), new AbortController().signal, { TextDecoder: decoder })))
    .toEqual([{ id: "1", event: "update", data: "café\nsecond" }]);
  expect(decoder).toHaveBeenCalledWith("utf-8", { fatal: true });
});

test("CR-only endings, empty data, ignored fields and NUL ids follow SSE field rules", async () => {
  expect(await collect(readSse(body([encode("id: good\rid: bad\0id\revent:\rretry: 1\runknown\rdata\r\rid: unused\r\rdata: next\r\r")]), new AbortController().signal)))
    .toEqual([{ id: "good", event: "message", data: "" }, { id: "", event: "message", data: "next" }]);
});

test("invalid UTF-8, including a truncated final code point, fails", async () => {
  for (const bytes of [Uint8Array.of(255), Uint8Array.of(0xc3)]) {
    await expect(collect(readSse(body([bytes]), new AbortController().signal))).rejects.toThrow();
  }
});

test("record caps reject complete and partial oversized records before delivery", async () => {
  for (const text of ["data: abc\n\n", "data: abc", "data:\ndata:\n\n"]) {
    await expect(collect(readSse(body([encode(text)]), new AbortController().signal, { maxEventBytes: 8 }))).rejects.toThrow("8 bytes");
  }
  await expect(collect(readSse(body([encode("x".repeat(1_048_577))]), new AbortController().signal))).rejects.toThrow("1048576 bytes");
  expect(await collect(readSse(body([encode("data:x\n\ndata:y\n\n")]), new AbortController().signal, { maxEventBytes: 8 })))
    .toEqual([{ id: "", event: "message", data: "x" }, { id: "", event: "message", data: "y" }]);
});

test("abort cancels a pending read, releases the lock and suppresses buffered records", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const reading = collect(readSse(stream, controller.signal));
  controller.abort();
  expect(await reading).toEqual([]);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
  const second = new AbortController();
  const records = readSse(body([encode("data: one\n\ndata: two\n\n")]), second.signal);
  expect((await records.next()).value).toMatchObject({ data: "one" });
  second.abort();
  expect((await records.next()).done).toBe(true);
});

test("transport supplies simple request defaults and cursor header or query parameter", async () => {
  for (const cursor of [undefined, { header: "Last-Event-ID" } as const, { param: "since" }]) {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("data: ok\n\n", { headers: { "Content-Type": "text/event-stream; charset=utf-8" } })));
    const open = eventStream<number>({ url: "/events?topic=a#section", fetch: fetcher, ...(cursor === undefined ? {} : { cursor }) });
    const opened = vi.fn();
    expect(await collect(open(5, new AbortController().signal, opened))).toEqual([{ id: "", event: "message", data: "ok" }]);
    expect(opened).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0];
    if (call === undefined) throw new Error("Missing fetch call");
    const [url, init] = call;
    expect(url).toBe(cursor !== undefined && "param" in cursor ? "/events?topic=a&since=5#section" : "/events?topic=a#section");
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual(cursor !== undefined && "header" in cursor ? { accept: "text/event-stream", "last-event-id": "5" } : { accept: "text/event-stream" });
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  }
});

test("transport distinguishes authentication, status, content type and fetch network failures", async () => {
  const cases: Array<[() => Promise<Response>, string]> = [
    [() => Promise.resolve(new Response("", { status: 401 })), "credentials were rejected (HTTP 401)"],
    [() => Promise.resolve(new Response("", { status: 403 })), "credentials were rejected (HTTP 403)"],
    [() => Promise.resolve(new Response("", { status: 503 })), "HTTP 503"],
    [() => Promise.resolve(new Response("html")), "not text/event-stream"],
    [() => Promise.resolve(new Response(undefined, { headers: { "content-type": "text/event-stream" } })), "no response body"],
    [() => Promise.reject(new TypeError("offline")), "Could not reach the live stream server: offline"],
  ];
  for (const [fetcher, message] of cases) {
    const opened = vi.fn();
    await expect(collect(eventStream({ url: "/events", fetch: fetcher })(undefined, new AbortController().signal, opened))).rejects.toThrow(message);
    expect(opened).not.toHaveBeenCalled();
  }
});

const context = { call: () => Promise.resolve(false) };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test("live retries from the decoder's accepted cursor, delivers duplicates and preserves its resource key", async () => {
  vi.useFakeTimers();
  const cursors: Array<number | undefined> = [];
  const messages: Array<{ type: string; value?: number }> = [];
  const onCursor = vi.fn<(cursor: number | undefined) => void>();
  const open: LiveTransport<number, number> = async function*(cursor, _signal, opened) {
    await Promise.resolve();
    cursors.push(cursor); opened();
    yield 5; yield 5; yield 3;
  };
  const options = {
    key: "resource:baseline", after: 1, open,
    decode: (value: number) => ({ message: { type: "record", value }, cursor: value }),
    retry: { initialMs: 1000, maxMs: 30_000, resetOn: "message" as const }, onCursor,
    setTimeout, clearTimeout,
  };
  const subscription = liveSubscription(options);
  expect(subscription.key).toBe(liveSubscription({ ...options, after: 99 }).key);
  const dispose = subscription.subscribe(message => { messages.push(message); }, context);
  await flush();
  expect(messages.map(message => message.value)).toEqual([5, 5, 3]);
  expect(onCursor.mock.calls.map(([cursor]) => cursor)).toEqual([5, 5, 3]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(cursors).toEqual([1, 3]);
  dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

test("failed decode retains the cursor and the exact error, with capped backoff and deduplicated health", async () => {
  vi.useFakeTimers();
  const failure = new TypeError("invalid record");
  const onError = vi.fn(); const onCursor = vi.fn<(cursor: number | undefined) => void>();
  const cursors: Array<number | undefined> = []; const messages: Array<LiveHealth | { kind: "disconnected" }> = [];
  const sub = liveSubscription<number, number, { type: string; value: LiveHealth | { kind: "disconnected" } }>({
    key: "feed", after: 7,
    open: async function*(cursor: number | undefined) { await Promise.resolve(); cursors.push(cursor); yield 8; },
    decode: () => { throw failure; },
    onError, onCursor,
    health: (value: LiveHealth) => ({ type: "health", value }),
    disconnected: () => ({ type: "health", value: { kind: "disconnected" as const } }),
    retry: { initialMs: 1000, maxMs: 30_000, resetOn: "message" }, setTimeout, clearTimeout,
  });
  const dispose = sub.subscribe(message => { messages.push(message.value); }, context);
  await flush();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = cursors.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(cursors).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(cursors).toHaveLength(before + 1);
  }
  expect(cursors).toEqual(Array<number>(8).fill(7));
  expect(onCursor).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(8);
  expect(onError).toHaveBeenLastCalledWith(failure);
  expect(messages).toEqual([{ kind: "problem", text: "invalid record" }, { kind: "disconnected" }]);
  dispose(); vi.useRealTimers();
});

for (const resetOn of ["open", "message"] as const) {
  test(`quiet connections reset backoff only on ${resetOn}; accepted records reset message backoff`, async () => {
    vi.useFakeTimers();
    let count = 0;
    const connected = vi.fn(() => ({ type: "connected" }));
    const disconnected = vi.fn(() => ({ type: "disconnected" }));
    const health = vi.fn((value: LiveHealth) => ({ type: "health", value }));
    const open: LiveTransport<string, never> = async function*(_cursor, _signal, opened) {
      await Promise.resolve();
      count++; opened(); opened();
      if (count === 3) yield "snapshot_required";
    };
    const messages: Array<string> = [];
    const dispose = liveSubscription({
      key: "quiet", open, decode: (type: string) => ({ message: { type } }),
      connected, disconnected, health, retry: { initialMs: 1000, maxMs: 30000, resetOn }, setTimeout, clearTimeout,
    }).subscribe(message => { messages.push(message.type); }, context);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(count).toBe(2);
    await vi.advanceTimersByTimeAsync(resetOn === "open" ? 1000 : 2000);
    expect(count).toBe(3);
    expect(messages).toContain("snapshot_required");
    await vi.advanceTimersByTimeAsync(1000);
    expect(count).toBe(4);
    expect(connected).toHaveBeenCalledTimes(4);
    expect(disconnected).toHaveBeenCalledTimes(4);
    expect(health.mock.calls.map(([value]) => value.kind)).toEqual(["healthy", "problem", "healthy", "problem", "healthy", "problem", "healthy", "problem"]);
    dispose(); vi.useRealTimers();
  });
}

test("disposing during decode prevents cursor hooks, messages and retries", async () => {
  vi.useFakeTimers();
  const dispatch = vi.fn(); const onCursor = vi.fn<(cursor: number | undefined) => void>(); const onError = vi.fn();
  const dispose = liveSubscription({
    key: "final", open: async function*() { await Promise.resolve(); yield "final"; },
    decode: () => { dispose(); return { message: { type: "done" }, cursor: 1 }; },
    onCursor, onError, retry: { initialMs: 1000, maxMs: 1000, resetOn: "open" }, setTimeout, clearTimeout,
  }).subscribe(dispatch, context);
  await flush();
  expect(dispatch).not.toHaveBeenCalled(); expect(onCursor).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
});

test("a final message can dispose in a microtask after the stream ends without scheduling a retry", async () => {
  vi.useFakeTimers();
  const disconnected = vi.fn(() => ({ type: "disconnected" }));
  const messages: Array<string> = [];
  const dispose = liveSubscription({
    key: "terminal", open: async function*() { await Promise.resolve(); yield "done"; },
    decode: (type: string) => ({ message: { type } }), disconnected,
    retry: { initialMs: 1000, maxMs: 1000, resetOn: "open" }, setTimeout, clearTimeout,
  }).subscribe(message => { messages.push(message.type); queueMicrotask(dispose); }, context);
  await flush();
  expect(messages).toEqual(["done"]); expect(disconnected).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
});

test("two mounted streams own their cursors and abort signals independently", async () => {
  vi.useFakeTimers();
  const signals: Array<AbortSignal> = [];
  const cursors: Array<number | undefined> = [];
  const onError = vi.fn();
  const open: LiveTransport<number, number> = async function*(cursor, signal, opened) {
    cursors.push(cursor); signals.push(signal); opened();
    await new Promise<void>((_resolve, reject) => { signal.addEventListener("abort", () => { reject(new Error("aborted")); }, { once: true }); });
    yield 1;
  };
  const options = {
    open, decode: (value: number) => ({ message: { type: "value", value } }), onError,
    retry: { initialMs: 1000, maxMs: 1000, resetOn: "open" as const }, setTimeout, clearTimeout
  };
  const a = liveSubscription({ ...options, key: "a", after: 1 }).subscribe(vi.fn(), context);
  const b = liveSubscription({ ...options, key: "b", after: 2 }).subscribe(vi.fn(), context);
  await flush(); expect(cursors).toEqual([1, 2]); a(); await flush();
  expect(signals.map(signal => signal.aborted)).toEqual([true, false]);
  b(); await flush(); expect(onError).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

test("invalid limits and retry policies fail before subscribing", async () => {
  for (const maxEventBytes of [0, -1, NaN, Infinity, 1.5]) {
    await expect(collect(readSse(body([]), new AbortController().signal, { maxEventBytes }))).rejects.toThrow("Invalid event byte limit");
  }
  for (const retry of [
    { initialMs: 0, maxMs: 1 }, { initialMs: 2, maxMs: 1 }, { initialMs: NaN, maxMs: 10 },
    { initialMs: 1, maxMs: Infinity }, { initialMs: 1, maxMs: 2 ** 31 },
    { initialMs: 1, maxMs: 10, factor: 0.5 }, { initialMs: 1, maxMs: 10, factor: NaN },
  ]) {
    expect(() => liveSubscription({
      key: "invalid", open: () => { throw new Error("must not open"); },
      decode: () => ({ message: { type: "value" } }), retry: { ...retry, resetOn: "open" },
    })).toThrow("Invalid live retry policy");
  }
});

test("the byte cap includes the UTF-8 BOM and bytes buffered by the decoder", async () => {
  await expect(collect(readSse(body([Uint8Array.of(0xef, 0xbb, 0xbf, ...encode("data:x\n\n"))]), new AbortController().signal, { maxEventBytes: 8 }))).rejects.toThrow("8 bytes");
  // The incomplete prefix counts toward the cap even before the decoder emits text.
  const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(0xe2, 0x82)); } });
  await expect(collect(readSse(oversized, new AbortController().signal, { maxEventBytes: 1 }))).rejects.toThrow("1 bytes");
});

test("transport passes credentials and headers, replaces query cursors, and omits undefined cursors", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("", { headers: { "content-type": "TEXT/EVENT-STREAM" } })));
  for (const [url, cursor, expected] of [["/events", 0, "/events?after=0"], ["/events?after=old&x=1", 9, "/events?after=9&x=1"], ["/events", undefined, "/events"]] as const) {
    await collect(eventStream<number>({ url, cursor: { param: "after" }, credentials: "omit", headers: { Authorization: "Bearer test" }, fetch: fetcher })(cursor, new AbortController().signal, vi.fn()));
    expect(fetcher).toHaveBeenLastCalledWith(expected, expect.objectContaining({ credentials: "omit" }));
  }
  const init = fetcher.mock.calls[0]?.[1];
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test");
  await collect(eventStream({ url: "/events", cursor: { header: "Last-Event-ID" }, fetch: fetcher })(undefined, new AbortController().signal, vi.fn()));
  expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).has("Last-Event-ID")).toBe(false);
});

test("transport error descriptions preserve causes and never relabel reader TypeErrors as network failures", async () => {
  for (const error of [new Error("server lost"), new TypeError(), "unknown", new Error("")]) {
    const describeError = vi.fn((_error: unknown, text: string) => `Custom: ${text}`);
    // Exercise an untyped external rejection, not just Error instances.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const open = eventStream({ url: "/events", fetch: () => Promise.reject(error), describeError });
    await expect(collect(open(undefined, new AbortController().signal, vi.fn()))).rejects.toThrow("Custom:");
    expect(describeError).toHaveBeenCalledTimes(1);
  }
  const error = new TypeError("broken reader");
  const open = eventStream({ url: "/events", fetch: () => Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.error(error); } }), { headers: { "content-type": "text/event-stream" } })) });
  await expect(collect(open(undefined, new AbortController().signal, vi.fn()))).rejects.toBe(error);
  await expect(collect(eventStream({ url: "/events", fetch: () => Promise.resolve(new Response()) })(undefined, new AbortController().signal, vi.fn()))).rejects.toThrow("no content type");
});

test("transport default fetch is injectable globally and aborted responses never open", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("data: ok\n\n", { headers: { "content-type": "text/event-stream" } })));
  vi.stubGlobal("fetch", fetcher);
  try {
    const controller = new AbortController(); controller.abort();
    const opened = vi.fn();
    expect(await collect(eventStream({ url: "/events" })(undefined, controller.signal, opened))).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
    const describeError = vi.fn();
    const failure = new Error("aborted");
    await expect(collect(eventStream({ url: "/events", fetch: () => Promise.reject(failure), describeError })(undefined, controller.signal, opened))).rejects.toBe(failure);
    expect(describeError).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

test("reader cancellation failures still release the lock", async () => {
  const stream = new ReadableStream<Uint8Array>({ cancel() { throw new Error("cancel failed"); } });
  const controller = new AbortController();
  const reading = collect(readSse(stream, controller.signal));
  controller.abort();
  expect(await reading).toEqual([]); expect(stream.locked).toBe(false);
  const errored = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("read failed")); } });
  await expect(collect(readSse(errored, new AbortController().signal))).rejects.toThrow("read failed");
  expect(errored.locked).toBe(false);
});

for (const hook of ["health", "connected", "onCursor", "onError"] as const) {
  test(`disposal from ${hook} suppresses subsequent dispatch and retry`, async () => {
    vi.useFakeTimers();
    const messages: Array<string> = [];
    const stop = () => { dispose(); };
    const dispose = liveSubscription({
      key: "stop-hook",
      open: async function*(_cursor: undefined, _signal, opened) { await Promise.resolve(); opened(); yield "done"; },
      decode: (type: string) => ({ message: { type } }),
      health: () => { if (hook === "health") stop(); return { type: "health" }; },
      connected: () => { if (hook === "connected") stop(); return { type: "connected" }; },
      onCursor: () => { if (hook === "onCursor") stop(); },
      onError: () => { if (hook === "onError") stop(); },
      disconnected: () => ({ type: "disconnected" }),
      retry: { initialMs: 1, maxMs: 1, resetOn: "open" },
    }).subscribe(message => { messages.push(message.type); }, context);
    await flush();
    expect(messages).toEqual(hook === "health" ? [] : hook === "connected" ? ["health"] : hook === "onCursor" ? ["health", "connected"] : ["health", "connected", "done"]);
    expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
  });
}

test("dispose before startup does not call the transport", async () => {
  const dispatch = vi.fn();
  const open = vi.fn<LiveTransport<string, never>>();
  const dispose = liveSubscription({
    key: "never-started", open, decode: (type: string) => ({ message: { type } }),
    retry: { initialMs: 1, maxMs: 1, resetOn: "open" },
  }).subscribe(dispatch, context);
  dispose(); await flush(); expect(open).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
});

test("a CR terminates an unfinished data line at EOF without dispatching it", async () => {
  expect(await collect(readSse(body([encode("data: partial\r")]), new AbortController().signal))).toEqual([]);
});

test("fetch reconnects with only the last decoded cursor and cancels the refused stream", async () => {
  vi.useFakeTimers();
  const failure = new TypeError("invalid payload");
  const onError = vi.fn(); const canceled = vi.fn(); const onCursor = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encode("id: ignored\ndata: 3\n\ndata: invalid\n\n")); }, cancel: canceled,
  }), { headers: { "content-type": "text/event-stream" } })));
  const received: Array<string> = [];
  const dispose = liveSubscription({
    key: "records", after: 1,
    open: eventStream<number>({ url: "/events", cursor: { param: "since_ms" }, fetch: fetcher }),
    decode: (record, cursor) => {
      if (record.data === "invalid") throw failure;
      expect(cursor).toBe(received.length === 0 ? 1 : 3);
      return { message: { type: "record", value: record.data }, cursor: Number(record.data) };
    }, onError, onCursor,
    retry: { initialMs: 1000, maxMs: 1000, resetOn: "message" }, setTimeout, clearTimeout,
  }).subscribe(message => { received.push(message.value); }, context);
  await flush(); await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/events?since_ms=1", "/events?since_ms=3"]);
  expect(received).toEqual(["3", "3"]); expect(onError).toHaveBeenLastCalledWith(failure);
  expect(onCursor).toHaveBeenCalledTimes(2); expect(canceled).toHaveBeenCalledTimes(2);
  dispose(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
});

test("a clean stream end before disposal cannot schedule a new retry", async () => {
  vi.useFakeTimers();
  const onError = vi.fn(); const dispatch = vi.fn();
  const dispose = liveSubscription({
    key: "end-first",
    open: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => {
          queueMicrotask(dispose);
          return Promise.resolve({ done: true as const, value: undefined });
        }
      })
    }), decode: () => ({ message: { type: "unused" } }), onError,
    disconnected: () => ({ type: "disconnected" }), retry: { initialMs: 1, maxMs: 1, resetOn: "open" }, setTimeout, clearTimeout,
  }).subscribe(dispatch, context);
  await flush();
  expect(dispatch).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

test("omitting a decoded cursor keeps it, and a caller can choose a retry factor", async () => {
  vi.useFakeTimers();
  const cursors: Array<string | undefined> = [];
  const dispose = liveSubscription({
    key: "factor", after: "initial",
    open: async function*(cursor: string | undefined) { await Promise.resolve(); cursors.push(cursor); if (cursors.length === 1) yield "first"; },
    decode: (type: string) => ({ message: { type } }),
    retry: { initialMs: 10, maxMs: 90, factor: 3, resetOn: "message" }, setTimeout, clearTimeout,
  }).subscribe(vi.fn(), context);
  await flush(); await vi.advanceTimersByTimeAsync(10); expect(cursors).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(29); expect(cursors).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); expect(cursors).toEqual(["initial", "initial", "initial"]);
  dispose(); vi.useRealTimers();
});
