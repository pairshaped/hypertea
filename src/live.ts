import type { ProgramMsg, ProgramSubscription } from "./index.js";

/** @public Part of the package boundary documented in README.md. */
export type SseRecord = Readonly<{ id: string; event: string; data: string }>;
/** @public Part of the package boundary documented in README.md. */
export type SseOptions = Readonly<{
  maxEventBytes?: number;
  TextDecoder?: typeof TextDecoder;
}>;

/** @public Part of the package boundary documented in README.md. */
export type LiveStreamFailure =
  | Readonly<{ kind: "network" }>
  | Readonly<{ kind: "rejected"; status: 401 | 403 }>
  | Readonly<{ kind: "status"; status: number }>
  | Readonly<{ kind: "content-type"; contentType: string | undefined }>
  | Readonly<{ kind: "no-body" }>
  | Readonly<{ kind: "record-too-large"; limitBytes: number }>
  | Readonly<{ kind: "invalid-utf8" }>
  | Readonly<{ kind: "disconnected" }>;

/** @public Part of the package boundary documented in README.md. */
export class LiveStreamError extends Error {
  readonly failure: LiveStreamFailure;
  constructor(failure: LiveStreamFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveStreamError";
    this.failure = failure;
  }
}

function eventLimit(options: SseOptions): number {
  const limit = options.maxEventBytes ?? 1_048_576;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid event byte limit");
  return limit;
}

/** Parse one stream. Only records terminated by a blank line are delivered. */
export async function* readSse(
  stream: ReadableStream<Uint8Array>, signal: AbortSignal, options: SseOptions = {},
): AsyncGenerator<SseRecord> {
  const limit = eventLimit(options);
  const aborted = () => signal.aborted;
  const decoder = new (options.TextDecoder ?? TextDecoder)("utf-8", { fatal: true });
  const reader = stream.getReader();
  const release = async () => {
    try { await reader.cancel(); } catch { /* Cancellation can fail after a read error. */ }
    reader.releaseLock();
  };
  const cancel = () => { void release(); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  let pending = "";
  let cr = false;
  let id = "";
  let event = "";
  let data: Array<string> = [];
  const count = (size: number) => {
    bytes += size;
    if (bytes > limit) throw new LiveStreamError({ kind: "record-too-large", limitBytes: limit }, `Live stream record exceeds ${String(limit)} bytes; refused without partial delivery`);
  };
  const utf8 = (input?: Uint8Array, streaming?: boolean): string => {
    try {
      return decoder.decode(input, { stream: streaming ?? false });
    } catch (error) {
      throw new LiveStreamError({ kind: "invalid-utf8" }, "Live stream contained invalid UTF-8", { cause: error });
    }
  };
  const line = (): SseRecord | undefined => {
    const text = pending;
    pending = "";
    if (text === "") {
      const record = data.length === 0 ? undefined : { id, event: event || "message", data: data.join("\n") };
      event = ""; data = []; bytes = 0;
      return record;
    }
    if (!text.startsWith(":")) {
      const colon = text.indexOf(":");
      const field = colon < 0 ? text : text.slice(0, colon);
      let value = colon < 0 ? "" : text.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "id" && !value.includes("\0")) id = value;
      if (field === "event") event = value;
      if (field === "data") data.push(value);
    }
    return undefined;
  };
  try {
    while (!aborted()) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (aborted()) return;
        throw new LiveStreamError({ kind: "disconnected" }, "Live stream connection dropped", { cause: error });
      }
      if (aborted()) return;
      if (chunk.done) {
        utf8(); // A truncated UTF-8 sequence fails even in an unfinished record.
        if (cr) {
          const record = line();
          if (record !== undefined) yield record;
        }
        return;
      }
      let offset = 0;
      while (offset < chunk.value.length && !aborted()) {
        if (cr) {
          cr = false;
          if (chunk.value[offset] === 10) { count(1); offset++; }
          const record = line();
          if (record !== undefined) yield record;
        } else {
          let end = offset;
          while (end < chunk.value.length && chunk.value[end] !== 10 && chunk.value[end] !== 13) end++;
          const terminated = end < chunk.value.length;
          const next = terminated ? end + 1 : end;
          count(next - offset);
          const text = utf8(chunk.value.subarray(offset, next), true);
          pending += terminated ? text.slice(0, -1) : text;
          offset = next;
          if (terminated) {
            if (chunk.value[end] === 13) cr = true;
            else {
              const record = line();
              if (record !== undefined) yield record;
            }
          }
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await release();
  }
}

/** @public Part of the package boundary documented in README.md. */
export type LiveTransport<Record, Cursor> = (
  cursor: Cursor | undefined, signal: AbortSignal, opened: () => void,
) => AsyncIterable<Record>;

/** @public Part of the package boundary documented in README.md. */
export type SseCursor = Readonly<{ header: "Last-Event-ID" }> | Readonly<{ param: string }>;

/** @public Part of the package boundary documented in README.md. */
export type EventStreamOptions = SseOptions & Readonly<{
  url: string;
  headers?: HeadersInit;
  cursor?: SseCursor;
  credentials?: RequestCredentials;
  describeError?: (error: unknown, defaultText: string) => string;
  fetch?: typeof fetch;
}>;

/** One fetch connection, with reconnect timing owned by liveSubscription. */
export function eventStream<Cursor = string>(options: EventStreamOptions): LiveTransport<SseRecord, Cursor> {
  eventLimit(options);
  return async function*(cursor, signal, opened) {
    const headers = new Headers(options.headers);
    headers.set("Accept", "text/event-stream");
    let url = options.url;
    if (options.cursor !== undefined && cursor !== undefined) {
      if ("header" in options.cursor) headers.set(options.cursor.header, String(cursor));
      else {
        const hash = url.indexOf("#");
        const fragment = hash < 0 ? "" : url.slice(hash);
        const base = hash < 0 ? url : url.slice(0, hash);
        const query = base.indexOf("?");
        const params = new URLSearchParams(query < 0 ? "" : base.slice(query + 1));
        params.set(options.cursor.param, String(cursor));
        url = `${query < 0 ? base : base.slice(0, query)}?${params.toString()}${fragment}`;
      }
    }
    let response: Response | undefined;
    try {
      try {
        response = await (options.fetch ?? fetch)(url, {
          headers, signal, cache: "no-store", credentials: options.credentials ?? "same-origin",
        });
      } catch (error) {
        if (error instanceof TypeError) throw new LiveStreamError({ kind: "network" }, `Could not reach the live stream server: ${error.message || "network failure"}`, { cause: error });
        throw error;
      }
      if (response.status === 401 || response.status === 403) throw new LiveStreamError({ kind: "rejected", status: response.status }, `Live stream credentials were rejected (HTTP ${String(response.status)})`);
      if (!response.ok) throw new LiveStreamError({ kind: "status", status: response.status }, `Live stream server answered HTTP ${String(response.status)}`);
      const contentType = response.headers.get("content-type") ?? undefined;
      if (contentType?.split(";")[0]?.trim().toLowerCase() !== "text/event-stream") throw new LiveStreamError({ kind: "content-type", contentType }, `Live stream response is not text/event-stream (${contentType ?? "no content type"}); a proxy may have answered instead`);
      if (response.body === null) throw new LiveStreamError({ kind: "no-body" }, "Live stream has no response body");
      if (signal.aborted) return;
      opened();
      yield* readSse(response.body, signal, options);
    } catch (error) {
      if (options.describeError === undefined || signal.aborted) throw error;
      const text = options.describeError(error, errorText(error));
      throw error instanceof LiveStreamError ? new LiveStreamError(error.failure, text, { cause: error }) : new Error(text, { cause: error });
    } finally {
      await response?.body?.cancel().catch(() => undefined);
    }
  };
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "The live stream failed without an error description";
}

/** @public Part of the package boundary documented in README.md. */
export type LiveHealth = Readonly<{ kind: "healthy" }> | Readonly<{ kind: "problem"; text: string }>;
/** @public Part of the package boundary documented in README.md. */
export type LiveRetry = Readonly<{ initialMs: number; maxMs: number; factor?: number; resetOn: "open" | "message" }>;
/** @public Part of the package boundary documented in README.md. */
export type LiveOptions<Record, Cursor, Msg extends ProgramMsg> = Readonly<{
  key: string;
  open: LiveTransport<Record, Cursor>;
  decode: (record: Record, cursor: Cursor | undefined) => Readonly<{ message: Msg; cursor?: Cursor }>;
  after?: Cursor;
  retry: LiveRetry;
  onCursor?: (cursor: Cursor | undefined) => void;
  onError?: (error: unknown) => void;
  health?: (health: LiveHealth) => Msg;
  connected?: () => Msg;
  disconnected?: () => Msg;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}>;

export function liveSubscription<Record, Cursor, Msg extends ProgramMsg>(
  options: LiveOptions<Record, Cursor, Msg>,
): ProgramSubscription<Msg> {
  const { initialMs, maxMs } = options.retry;
  const factor = options.retry.factor ?? 2;
  if (!Number.isFinite(initialMs) || initialMs <= 0 || !Number.isFinite(maxMs) || maxMs < initialMs || maxMs > 2_147_483_647 || !Number.isFinite(factor) || factor < 1) {
    throw new Error("Invalid live retry policy");
  }
  return {
    key: options.key,
    subscribe: dispatch => {
      let stopped = false;
      const inactive = () => stopped;
      let cursor = options.after;
      let delay = options.retry.initialMs;
      let attempt: AbortController;
      let healthy: boolean | undefined;
      let reported: LiveHealth | undefined;
      const emit = (message: (() => Msg) | undefined) => {
        if (inactive() || message === undefined) return;
        const value = message();
        if (!inactive()) dispatch(value);
      };
      const report = (value: LiveHealth) => {
        if (reported?.kind === value.kind && (value.kind === "healthy" || (reported.kind === "problem" && reported.text === value.text))) return;
        reported = value;
        const health = options.health;
        if (health !== undefined) emit(() => health(value));
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = options.setTimeout ?? setTimeout;
      const cancel = options.clearTimeout ?? clearTimeout;
      const run = async () => {
        const connection = new AbortController();
        attempt = connection;
        let opened = false;
        // Let the Program install this subscription before an open callback dispatches.
        await Promise.resolve();
        if (inactive()) return;
        try {
          for await (const record of options.open(cursor, connection.signal, () => {
            if (inactive() || connection.signal.aborted || opened) return;
            opened = true;
            healthy = true;
            if (options.retry.resetOn === "open") delay = options.retry.initialMs;
            report({ kind: "healthy" });
            emit(options.connected);
          })) {
            if (inactive()) break;
            const accepted = options.decode(record, cursor);
            if (inactive()) break;
            if (accepted.cursor !== undefined) cursor = accepted.cursor;
            options.onCursor?.(cursor);
            if (!inactive()) dispatch(accepted.message);
            if (options.retry.resetOn === "message") delay = options.retry.initialMs;
          }
          if (!inactive()) throw new Error("Live stream ended");
        } catch (error) {
          if (!inactive()) {
            options.onError?.(error);
            report({ kind: "problem", text: errorText(error) });
            if (healthy !== false) {
              healthy = false;
              emit(options.disconnected);
            }
          }
        } finally {
          connection.abort();
          if (!inactive()) {
            timer = schedule(() => { timer = undefined; void run(); }, delay);
            delay = Math.min(options.retry.maxMs, delay * factor);
          }
        }
      };
      void run();
      return () => {
        stopped = true;
        attempt.abort();
        if (timer !== undefined) cancel(timer);
      };
    },
  };
}
