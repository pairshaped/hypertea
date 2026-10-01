import { describe, expect, test, vi } from "vitest";

import { createSocketTransport } from "./socket-transport.js";

class FakeSocket extends EventTarget {
  readyState = 1;
  sent: Array<string> = [];
  closed = false;
  failSend = false;
  listeners = new Map<string, EventListener>();

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (typeof callback === "function") this.listeners.set(type, callback);
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (this.listeners.get(type) === callback) this.listeners.delete(type);
    super.removeEventListener(type, callback, options);
  }

  send(data: string) {
    if (this.failSend) throw new Error("send failed");
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  reply(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function parseNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("expected number");
  return value;
}

function sentRequest(socket: FakeSocket, index: number): { requestId: number } {
  const frame = socket.sent[index];
  if (frame === undefined) throw new Error("missing sent frame");
  const value: unknown = JSON.parse(frame);
  if (typeof value !== "object" || value === null || !("requestId" in value)
    || typeof value.requestId !== "number" || "generation" in value || !("version" in value) || value.version !== 2) {
    throw new Error("invalid sent frame");
  }
  return { requestId: value.requestId };
}

describe("socket operation transport", () => {
  test("correlates simultaneous requests whose replies arrive in reverse order", async () => {
    const transport = createSocketTransport();
    const socket = new FakeSocket();
    expect(transport.connect(() => socket.asWebSocket())).toBe(true);
    const first = transport.request("first", { id: 1 }, parseNumber);
    const second = transport.request("second", { id: 2 }, parseNumber);
    const a = sentRequest(socket, 0);
    const b = sentRequest(socket, 1);

    socket.reply({ version: 2, requestId: b.requestId, status: "ok", payload: 20 });
    socket.reply({ version: 2, requestId: a.requestId, status: "ok", payload: 10 });

    expect(await first).toEqual({ status: "applied", value: 10 });
    expect(await second).toEqual({ status: "applied", value: 20 });
    socket.reply({ version: 2, requestId: a.requestId, status: "ok", payload: 99 });
    expect(transport.pendingCount()).toBe(0);
    transport.stop();
  });

  test("rejects malformed input and responses without dispatching or hanging", async () => {
    const transport = createSocketTransport({ maxPending: 1, maxFrameBytes: 256 });
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    expect(await transport.request("bad name", {}, parseNumber)).toEqual({ status: "not-dispatched", reason: "invalid-request" });
    expect(await transport.request("BadName", {}, parseNumber)).toEqual({ status: "not-dispatched", reason: "invalid-request" });
    expect(await transport.request("read", { text: "x".repeat(300) }, parseNumber)).toEqual({ status: "not-dispatched", reason: "invalid-request" });
    const pending = transport.request("read", {}, parseNumber);
    expect(await transport.request("other", {}, parseNumber)).toEqual({ status: "not-dispatched", reason: "busy" });
    const request = sentRequest(socket, 0);
    socket.reply({ version: 2, requestId: request.requestId, status: "ok", payload: "wrong" });
    expect(await pending).toEqual({ status: "unknown", reason: "invalid-response" });

    const another = transport.request("read", {}, parseNumber);
    const secondRequest = sentRequest(socket, 1);
    socket.reply({ version: 2, requestId: secondRequest.requestId, status: "ok" });
    expect(await another).toEqual({ status: "unknown", reason: "invalid-envelope" });
    expect(socket.closed).toBe(true);

    const next = new FakeSocket();
    transport.connect(() => next.asWebSocket());
    const third = transport.request("read", {}, parseNumber);
    next.dispatchEvent(new MessageEvent("message", { data: "not JSON" }));
    expect(await third).toEqual({ status: "unknown", reason: "invalid-envelope" });
    transport.stop();
  });

  test("disconnect, cancellation and reconnect never replay a request or accept a late reply", async () => {
    const transport = createSocketTransport();
    const old = new FakeSocket();
    transport.connect(() => old.asWebSocket());
    const controller = new AbortController();
    controller.abort();
    expect(await transport.request("read", {}, parseNumber, controller.signal)).toEqual({ status: "not-dispatched", reason: "canceled" });
    const pending = transport.request("write", { id: 1 }, parseNumber);
    const oldRequest = sentRequest(old, 0);
    old.close();
    expect(await pending).toEqual({ status: "unknown", reason: "disconnected" });

    const next = new FakeSocket();
    transport.connect(() => next.asWebSocket());
    const read = transport.request("read", {}, parseNumber);
    const nextRequest = sentRequest(next, 0);
    expect(nextRequest.requestId).toBeGreaterThan(oldRequest.requestId);
    old.reply({ version: 2, requestId: oldRequest.requestId, status: "ok", payload: 1 });
    expect(transport.pendingCount()).toBe(1);
    next.reply({ version: 2, requestId: nextRequest.requestId, status: "ok", payload: 3 });
    expect(await read).toEqual({ status: "applied", value: 3 });
    expect(old.sent).toHaveLength(1);
    transport.stop();
    expect(next.closed).toBe(true);
    expect(transport.connect(() => next.asWebSocket())).toBe(false);
    expect(await transport.request("read", {}, parseNumber)).toEqual({ status: "not-dispatched", reason: "stopped" });
  });

  test("caller cancellation after dispatch reports unknown and removes its callback", async () => {
    const transport = createSocketTransport();
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    const controller = new AbortController();
    const parse = vi.fn(parseNumber);
    const pending = transport.request("write", {}, parse, controller.signal);
    const request = sentRequest(socket, 0);
    controller.abort();
    expect(await pending).toEqual({ status: "unknown", reason: "canceled" });
    socket.reply({ version: 2, ...request, status: "ok", payload: 10 });
    expect(parse).not.toHaveBeenCalled();
    expect(transport.pendingCount()).toBe(0);
    transport.stop();
  });

  test("queued callbacks from replaced sockets cannot affect the next connection", async () => {
    const transport = createSocketTransport();
    const old = new FakeSocket();
    transport.connect(() => old.asWebSocket());
    const oldMessage = old.listeners.get("message");
    const oldClose = old.listeners.get("close");
    if (oldMessage === undefined || oldClose === undefined) throw new Error("missing listeners");
    const next = new FakeSocket();
    transport.connect(() => next.asWebSocket());
    const pending = transport.request("read", {}, parseNumber);
    const request = sentRequest(next, 0);
    oldMessage(new MessageEvent("message", { data: JSON.stringify({ version: 2, ...request, status: "ok", payload: 8 }) }));
    oldClose(new Event("close"));
    expect(transport.pendingCount()).toBe(1);
    next.reply({ version: 2, ...request, status: "ok", payload: 9 });
    expect(await pending).toEqual({ status: "applied", value: 9 });
    transport.stop();
  });

  test("bounded error replies are correlated and malformed reply shapes fail closed", async () => {
    const transport = createSocketTransport({ maxFrameBytes: 256 });
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    const rejected = transport.request("read", {}, parseNumber);
    const first = sentRequest(socket, 0);
    socket.reply({ version: 2, ...first, status: "error", error: { code: "denied", message: "No access" } });
    expect(await rejected).toEqual({ status: "rejected", code: "denied", message: "No access" });

    const invalid = transport.request("read", {}, parseNumber);
    const second = sentRequest(socket, 1);
    socket.reply({ version: 2, ...second, status: "error", error: { code: 7, message: "bad" } });
    expect(await invalid).toEqual({ status: "unknown", reason: "invalid-response" });

    const oversized = transport.request("read", {}, parseNumber);
    socket.dispatchEvent(new MessageEvent("message", { data: "x".repeat(257) }));
    expect(await oversized).toEqual({ status: "unknown", reason: "invalid-envelope" });
    transport.stop();
  });

  test("invalid envelope fields never complete a request", async () => {
    const invalidReplies: Array<(request: { requestId: number }) => unknown> = [
      () => null,
      () => [],
      (request) => ({ ...request, version: 1, status: "ok", payload: 2 }),
      (request) => ({ ...request, version: 2, generation: 1, status: "ok", payload: 2 }),
      (request) => ({ ...request, version: 2, requestId: 0, status: "ok", payload: 2 }),
      (request) => ({ ...request, version: 2, status: "other", payload: 2 }),
      (request) => ({ ...request, version: 2, status: "error" }),
      (request) => ({ ...request, version: 2, status: "ok", payload: 2, extra: true }),
    ];
    for (const makeReply of invalidReplies) {
      const transport = createSocketTransport();
      const socket = new FakeSocket();
      transport.connect(() => socket.asWebSocket());
      const pending = transport.request("read", {}, parseNumber);
      socket.reply(makeReply(sentRequest(socket, 0)));
      expect(await pending).toEqual({ status: "unknown", reason: "invalid-envelope" });
      transport.stop();
    }
  });

  test("factory, payload, send and lifecycle failures preserve dispatch truth", async () => {
    expect(() => createSocketTransport({ maxPending: 0 })).toThrow("Invalid socket transport limits");
    expect(() => createSocketTransport({ maxFrameBytes: 1 })).toThrow("Invalid socket transport limits");
    const transport = createSocketTransport();
    expect(transport.connect(() => { throw new Error("offline"); })).toBe(false);
    expect(await transport.request("read", {}, parseNumber)).toEqual({ status: "not-dispatched", reason: "unavailable" });
    const socket = new FakeSocket();
    socket.readyState = 0;
    transport.connect(() => socket.asWebSocket());
    expect(await transport.request("read", {}, parseNumber)).toEqual({ status: "not-dispatched", reason: "unavailable" });
    socket.readyState = 1;
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(await transport.request("read", cyclic, parseNumber)).toEqual({ status: "not-dispatched", reason: "invalid-request" });
    expect(await transport.request("read", undefined, parseNumber)).toEqual({ status: "not-dispatched", reason: "invalid-request" });
    socket.failSend = true;
    expect(await transport.request("write", {}, parseNumber)).toEqual({ status: "unknown", reason: "send-failed" });
    socket.failSend = false;
    const pending = transport.request("write", {}, parseNumber);
    const replacement = new FakeSocket();
    transport.connect(() => replacement.asWebSocket());
    expect(await pending).toEqual({ status: "unknown", reason: "disconnected" });
    const parseAfterStop = vi.fn(parseNumber);
    const final = transport.request("write", {}, parseAfterStop);
    const lateMessage = replacement.listeners.get("message");
    if (lateMessage === undefined) throw new Error("missing message listener");
    transport.stop();
    expect(await final).toEqual({ status: "unknown", reason: "stopped" });
    expect(replacement.listeners.size).toBe(0);
    lateMessage(new MessageEvent("message", { data: JSON.stringify({ version: 2, ...sentRequest(replacement, 0), status: "ok", payload: 42 }) }));
    replacement.reply({ version: 2, ...sentRequest(replacement, 0), status: "ok", payload: 43 });
    expect(parseAfterStop).not.toHaveBeenCalled();
    expect(transport.pendingCount()).toBe(0);
    transport.stop();
  });
});

describe("server-pushed events", () => {
  const event = (name: string, payload: unknown) => ({ version: 2, kind: "event", event: name, payload });

  test("delivers events in arrival order between replies and never as replies", async () => {
    const transport = createSocketTransport();
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    const seen: Array<string> = [];
    transport.on("changed", parseNumber, (value) => { seen.push(`event ${String(value)}`); });
    const read = transport.request("read", {}, parseNumber);
    void read.then(() => { seen.push("reply"); });
    const request = sentRequest(socket, 0);
    socket.reply(event("changed", 1));
    socket.reply({ version: 2, requestId: request.requestId, status: "ok", payload: 7 });
    socket.reply(event("changed", 2));
    expect(await read).toEqual({ status: "applied", value: 7 });
    expect(seen).toEqual(["event 1", "event 2", "reply"]);
    expect(transport.pendingCount()).toBe(0);
    transport.stop();
  });

  test("ignores an event nobody handles and rejects handlers without a live connection", () => {
    const transport = createSocketTransport();
    expect(transport.on("changed", parseNumber, vi.fn())).toBeUndefined();
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    expect(transport.on("Bad Name", parseNumber, vi.fn())).toBeUndefined();
    socket.reply(event("other", 1));
    expect(socket.closed).toBe(false);
    transport.stop();
    expect(transport.on("changed", parseNumber, vi.fn())).toBeUndefined();
  });

  test("a payload that fails its parser closes the socket and fails pending requests as unknown", async () => {
    const transport = createSocketTransport();
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    const handler = vi.fn();
    transport.on("changed", parseNumber, handler);
    const pending = transport.request("write", {}, parseNumber);
    socket.reply(event("changed", "not a number"));
    expect(await pending).toEqual({ status: "unknown", reason: "invalid-response" });
    expect(handler).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
  });

  test.each([
    ["an unknown kind", { version: 2, kind: "notice", event: "changed", payload: 1 }],
    ["a version 1 event", { version: 1, kind: "event", event: "changed", payload: 1 }],
    ["a missing payload", { version: 2, kind: "event", event: "changed" }],
    ["a bad event name", { version: 2, kind: "event", event: "Bad Name", payload: 1 }],
    ["a non-string event", { version: 2, kind: "event", event: 7, payload: 1 }],
    ["a reply field on an event", { version: 2, kind: "event", event: "changed", payload: 1, requestId: 1 }],
  ])("%s closes the socket and fails pending requests as unknown", async (_name, frame) => {
    const transport = createSocketTransport();
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    const handler = vi.fn();
    transport.on("changed", parseNumber, handler);
    const pending = transport.request("write", {}, parseNumber);
    socket.reply(frame);
    expect(await pending).toEqual({ status: "unknown", reason: "invalid-envelope" });
    expect(handler).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
  });

  test("an oversize event frame closes the socket", async () => {
    const transport = createSocketTransport({ maxFrameBytes: 256 });
    const socket = new FakeSocket();
    transport.connect(() => socket.asWebSocket());
    const handler = vi.fn();
    transport.on("changed", (value) => String(value), handler);
    const pending = transport.request("write", {}, parseNumber);
    socket.reply(event("changed", "x".repeat(300)));
    expect(await pending).toEqual({ status: "unknown", reason: "invalid-envelope" });
    expect(handler).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
  });

  test("a handler ends on removal, replacement, reconnect, stop and a closed socket, and a replaced socket's events are ignored", () => {
    const transport = createSocketTransport();
    const first = new FakeSocket();
    transport.connect(() => first.asWebSocket());
    const received: Array<string> = [];
    const removeFirst = transport.on("changed", parseNumber, (value) => { received.push(`a${String(value)}`); });
    const removeSecond = transport.on("changed", parseNumber, (value) => { received.push(`b${String(value)}`); });
    first.reply(event("changed", 1));
    removeFirst?.();
    first.reply(event("changed", 2));
    removeSecond?.();
    first.reply(event("changed", 3));
    expect(received).toEqual(["b1", "b2"]);

    transport.on("changed", parseNumber, (value) => { received.push(`c${String(value)}`); });
    const second = new FakeSocket();
    transport.connect(() => second.asWebSocket());
    first.reply(event("changed", 4));
    second.reply(event("changed", 5));
    expect(received).toEqual(["b1", "b2"]);

    transport.on("changed", parseNumber, (value) => { received.push(`d${String(value)}`); });
    second.close();
    second.reply(event("changed", 6));
    const third = new FakeSocket();
    transport.connect(() => third.asWebSocket());
    transport.on("changed", parseNumber, (value) => { received.push(`e${String(value)}`); });
    transport.stop();
    third.reply(event("changed", 7));
    expect(received).toEqual(["b1", "b2"]);
  });
});
