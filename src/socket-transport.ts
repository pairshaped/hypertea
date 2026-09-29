/** Correlated JSON requests over a program-owned WebSocket. No request is replayed. */
export type SocketResult<Value> =
  | Readonly<{ status: "applied"; value: Value }>
  | Readonly<{ status: "rejected"; code: string; message: string }>
  | Readonly<{ status: "not-dispatched"; reason: "canceled" | "invalid-request" | "busy" | "unavailable" | "stopped" }>
  | Readonly<{ status: "unknown"; reason: "canceled" | "disconnected" | "invalid-envelope" | "invalid-response" | "send-failed" | "stopped" }>;

export type SocketTransport = Readonly<{
  connect: (createSocket: () => WebSocket) => boolean;
  request: <Value>(operation: string, payload: unknown, parse: (value: unknown) => Value, signal?: AbortSignal) => Promise<SocketResult<Value>>;
  pendingCount: () => number;
  stop: () => void;
}>;

type Pending = Readonly<{
  receive: (reply: Record<string, unknown>) => void;
  fail: (reason: Extract<SocketResult<unknown>, { status: "unknown" }>["reason"]) => void;
}>;

export function createSocketTransport(options: Readonly<{ maxPending?: number; maxFrameBytes?: number }> = {}): SocketTransport {
  const maxPending = options.maxPending ?? 32;
  const maxFrameBytes = options.maxFrameBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 128) {
    throw new Error("Invalid socket transport limits");
  }

  let socket: WebSocket | undefined;
  let generation = 0;
  let nextRequestId = 0;
  let stopped = false;
  let removeListeners: (() => void) | undefined;
  const pending = new Map<number, Pending>();
  const bytes = (value: string) => new TextEncoder().encode(value).length;

  const failPending = (reason: Extract<SocketResult<unknown>, { status: "unknown" }>["reason"]) => {
    for (const request of [...pending.values()]) request.fail(reason);
  };
  const detach = (reason: Extract<SocketResult<unknown>, { status: "unknown" }>["reason"]) => {
    removeListeners?.();
    removeListeners = undefined;
    failPending(reason);
    const previous = socket;
    socket = undefined;
    previous?.close();
  };

  return {
    connect: (createSocket) => {
      if (stopped) return false;
      detach("disconnected");
      let nextSocket: WebSocket;
      try { nextSocket = createSocket(); } catch { return false; }
      socket = nextSocket;
      generation += 1;
      const connectionGeneration = generation;
      const onMessage = (event: MessageEvent) => {
        if (socket !== nextSocket || generation !== connectionGeneration) return;
        if (typeof event.data !== "string" || bytes(event.data) > maxFrameBytes) {
          detach("invalid-envelope");
          return;
        }
        let value: unknown;
        try { value = JSON.parse(event.data); } catch { detach("invalid-envelope"); return; }
        if (typeof value !== "object" || value === null || Array.isArray(value)) { detach("invalid-envelope"); return; }
        const reply = value as Record<string, unknown>;
        if (!Number.isSafeInteger(reply.generation) || (reply.generation as number) < 1) { detach("invalid-envelope"); return; }
        if (reply.generation !== connectionGeneration) return;
        if (reply.version !== 1 || !Number.isSafeInteger(reply.requestId) || (reply.requestId as number) < 1
          || (reply.status !== "ok" && reply.status !== "error")
          || (reply.status === "ok" && !Object.hasOwn(reply, "payload"))
          || (reply.status === "error" && !Object.hasOwn(reply, "error"))) {
          detach("invalid-envelope");
          return;
        }
        pending.get(reply.requestId as number)?.receive(reply);
      };
      const onClose = () => {
        if (socket === nextSocket) detach("disconnected");
      };
      nextSocket.addEventListener("message", onMessage);
      nextSocket.addEventListener("close", onClose);
      nextSocket.addEventListener("error", onClose);
      removeListeners = () => {
        nextSocket.removeEventListener("message", onMessage);
        nextSocket.removeEventListener("close", onClose);
        nextSocket.removeEventListener("error", onClose);
      };
      return true;
    },
    request: (operation, payload, parse, signal) => {
      if (stopped) return Promise.resolve({ status: "not-dispatched", reason: "stopped" });
      if (signal?.aborted === true) return Promise.resolve({ status: "not-dispatched", reason: "canceled" });
      const activeSocket = socket;
      if (activeSocket?.readyState !== 1) return Promise.resolve({ status: "not-dispatched", reason: "unavailable" });
      if (pending.size >= maxPending) return Promise.resolve({ status: "not-dispatched", reason: "busy" });
      if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(operation) || payload === undefined || nextRequestId === Number.MAX_SAFE_INTEGER) {
        return Promise.resolve({ status: "not-dispatched", reason: "invalid-request" });
      }
      const requestId = ++nextRequestId;
      let frame: string;
      try { frame = JSON.stringify({ version: 1, generation, requestId, operation, payload }); }
      catch { return Promise.resolve({ status: "not-dispatched", reason: "invalid-request" }); }
      if (bytes(frame) > maxFrameBytes) return Promise.resolve({ status: "not-dispatched", reason: "invalid-request" });
      return new Promise<SocketResult<ReturnType<typeof parse>>>((resolve) => {
        const finish = (result: SocketResult<ReturnType<typeof parse>>) => {
          pending.delete(requestId);
          signal?.removeEventListener("abort", cancel);
          resolve(result);
        };
        const cancel = () => { finish({ status: "unknown", reason: "canceled" }); };
        pending.set(requestId, {
          receive: (reply) => {
            if (reply.status === "error") {
              const error = reply.error;
              if (typeof error !== "object" || error === null || Array.isArray(error)
                || typeof (error as Record<string, unknown>).code !== "string"
                || typeof (error as Record<string, unknown>).message !== "string") {
                finish({ status: "unknown", reason: "invalid-response" });
                return;
              }
              finish({ status: "rejected", code: (error as { code: string }).code, message: (error as { message: string }).message });
              return;
            }
            try { finish({ status: "applied", value: parse(reply.payload) }); }
            catch { finish({ status: "unknown", reason: "invalid-response" }); }
          },
          fail: (reason) => { finish({ status: "unknown", reason }); },
        });
        signal?.addEventListener("abort", cancel, { once: true });
        try { activeSocket.send(frame); }
        catch { finish({ status: "unknown", reason: "send-failed" }); }
      });
    },
    pendingCount: () => pending.size,
    stop: () => {
      if (stopped) return;
      stopped = true;
      detach("stopped");
    },
  };
}
