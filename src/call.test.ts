import { expect, test, vi } from "vitest";
import { defineProgram, h, reply, mountProgram as mountProduction, effectOrigin, type EffectOrigin, type SubscriptionContext } from "./program.js";
import { mountProgram } from "./testing.js";

test("overlapping calls answer through their own captured continuations", async () => {
  type Msg = { type: "request" } | { type: "done"; value: string };
  const program = defineProgram<undefined, string, Msg, { type: "load" }>({
    init: () => ["initial", []],
    update: (model, message) => message.type === "request"
      ? [model, [{ type: "load" }]]
      : [message.value, [reply(message.value)]],
    view: model => h("output", {}, model),
  });
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProgram({ flags: undefined, node, program });
  const first = mounted.call({ type: "request" });
  const second = mounted.call({ type: "request" });
  const a = required(mounted.takeEffect());
  const b = required(mounted.takeEffect());
  mounted.dispatch({ type: "done", value: "human" });
  b.dispatch({ type: "done", value: "second" });
  await expect(second).resolves.toBe("second");
  a.dispatch({ type: "done", value: "first" });
  await expect(first).resolves.toBe("first");
  expect(node.textContent).toBe("first");
  mounted.stop();
});

test("a reply flushes hidden-tab rendering before effects and survives teardown", async () => {
  const frames: Array<FrameRequestCallback> = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.push(frame); return 1; });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  let renders = 0;
  let call: SubscriptionContext<Msg>["call"] | undefined;
  type Msg = { type: "answer" };
  const subscription = { key: "tools", subscribe: (_send: (message: Msg) => void, context: SubscriptionContext<Msg>) => {
    call = context.call;
    return () => { /* no external resource */ };
  } };
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProduction({ flags: undefined, node,
    program: defineProgram<undefined, number, Msg, { type: "inspect" }>({
      init: () => [0, []],
      update: () => [1, [{ type: "inspect" }, reply({ status: "applied" }), reply("duplicate")]],
      view: model => { renders += 1; return h("output", {}, String(model)); },
      subscriptions: model => model === 0 ? [subscription] : [],
    }),
    runEffect: async (_send, _effect, context) => {
      expect(node.textContent).toBe("1");
      await context.settle();
    },
  });
  await expect(required(call)({ type: "answer" })).resolves.toEqual({ status: "applied" });
  const count = renders;
  for (const frame of frames) frame(0);
  expect(renders).toBe(count);
  mounted.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("calls reject on cancellation and unanswered effects, while pending chains retain origin", async () => {
  type Msg = { type: "begin" } | { type: "done" } | { type: "empty" };
  const origins: Array<EffectOrigin | undefined> = [];
  let send: ((message: Msg) => void) | undefined;
  let release: (() => void) | undefined;
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProduction({ flags: undefined, node,
    program: defineProgram<undefined, number, Msg, { type: "wait" }>({
      init: () => [0, []],
      update: (model, message, origin) => {
        origins.push(origin);
        if (message.type === "begin") return [model, [{ type: "wait" }]];
        return [model + 1, message.type === "done" ? [reply("done")] : []];
      },
      view: model => h("output", {}, String(model)),
    }),
    runEffect: dispatch => {
      send = dispatch;
      expect(effectOrigin(dispatch)).toBe("native");
      return new Promise<void>(resolve => { release = resolve; });
    },
  });
  const aborted = new AbortController();
  aborted.abort();
  await expect(mounted.call({ type: "begin" }, { signal: aborted.signal })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  expect(origins).toEqual([]);
  await expect(mounted.call({ type: "empty" })).rejects.toMatchObject({ outcome: "unknown" });
  const pending = mounted.call({ type: "begin" }, { origin: "native" });
  await Promise.resolve();
  required(send)({ type: "done" });
  required(release)();
  await expect(pending).resolves.toBe("done");
  expect(origins).toEqual([undefined, "native", "native"]);
  const abort = new AbortController();
  const cancelled = mounted.call({ type: "begin" }, { origin: "native", signal: abort.signal });
  abort.abort();
  await expect(cancelled).rejects.toMatchObject({ outcome: "unknown" });
  required(send)({ type: "done" });
  required(release)();
  expect(mounted.model()).toBe(3);
  const unanswered = mounted.call({ type: "begin" }, { origin: "native" });
  required(release)();
  await expect(unanswered).rejects.toMatchObject({ outcome: "unknown" });
  const stopped = mounted.call({ type: "begin" }, { origin: "native" });
  mounted.stop();
  await expect(stopped).rejects.toMatchObject({ outcome: "unknown" });
  required(release)();
  await expect(mounted.call({ type: "empty" })).rejects.toMatchObject({ outcome: "unknown" });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected captured continuation");
  return value;
}

test("nested async continuations preserve fallback origin and literal outcomes", async () => {
  type Msg = { type: "step"; depth: number };
  const node = document.createElement("output");
  document.body.append(node);
  const observed: Array<EffectOrigin | undefined> = [];
  const mounted = mountProduction({ flags: undefined, node,
    program: defineProgram<undefined, number, Msg, { type: "next"; depth: number }>({
      init: () => [0, []],
      update: (_model, msg, origin) => {
        observed.push(origin);
        return [msg.depth, msg.depth === 3 ? [reply({ status: "superseded" })] : [{ type: "next", depth: msg.depth + 1 }]];
      },
      view: model => h("output", {}, String(model)),
    }),
    runEffect: async (send, effect) => {
      await Promise.resolve();
      send({ type: "step", depth: effect.depth });
    },
  });
  await expect(mounted.call({ type: "step", depth: 1 }, { origin: "fallback" })).resolves.toEqual({ status: "superseded" });
  expect(observed).toEqual(["fallback", "fallback", "fallback"]);
  mounted.stop();
});

test.each(["sync", "throw", "reject", "update-throw"] as const)("unanswered %s chains reject unknown", async mode => {
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProduction({ flags: undefined, node,
    program: defineProgram<undefined, number, { type: "request" }, { type: "work" }>({
      init: () => [0, []],
      update: model => {
        if (mode === "update-throw") throw new Error("invalid update");
        return [model, [{ type: "work" }]];
      },
      view: model => h("output", {}, String(model)),
    }),
    runEffect: () => {
      if (mode === "throw") throw new Error("failed effect");
      if (mode === "reject") return Promise.reject(new Error("failed effect"));
      return undefined;
    },
  });
  await expect(mounted.call({ type: "request" })).rejects.toMatchObject({ outcome: "unknown" });
  mounted.stop();
});

test("withdrawn subscription calls reject while their later messages still update", async () => {
  type Msg = { type: "request" } | { type: "withdraw" } | { type: "done" };
  let call: SubscriptionContext<Msg>["call"] | undefined;
  const sub = { key: "calls", subscribe: (_send: (message: Msg) => void, context: SubscriptionContext<Msg>) => {
    call = context.call;
    return () => { /* no resource */ };
  } };
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProgram({ flags: undefined, node,
    program: defineProgram<undefined, number, Msg, { type: "work" }>({
      init: () => [0, []],
      update: (model, msg) => msg.type === "request" ? [model, [{ type: "work" }]]
        : [model + 1, msg.type === "done" ? [reply("late")] : []],
      view: model => h("output", {}, String(model)),
      subscriptions: model => model === 0 ? [sub] : [],
    }),
  });
  const pending = required(call)({ type: "request" });
  const effect = required(mounted.takeEffect());
  mounted.dispatch({ type: "withdraw" });
  await expect(pending).rejects.toMatchObject({ outcome: "unknown" });
  effect.dispatch({ type: "done" });
  expect(mounted.model()).toBe(2);
  await expect(required(call)({ type: "request" })).rejects.toMatchObject({ outcome: "unknown" });
  mounted.stop();
});

test("failed subscription setup rejects calls it already issued", async () => {
  type Msg = { type: "request" };
  let pending: Promise<unknown> | undefined;
  const node = document.createElement("output");
  document.body.append(node);
  expect(() => mountProgram({ flags: undefined, node,
    program: defineProgram<undefined, number, Msg, { type: "work" }>({
      init: () => [0, []],
      update: model => [model, [{ type: "work" }]],
      view: model => h("output", {}, String(model)),
      subscriptions: () => [{ key: "failed", subscribe: (_send, context) => {
        pending = context.call({ type: "request" });
        throw new Error("registration failed");
      } }],
    }),
  })).toThrow("registration failed");
  await expect(required(pending)).rejects.toMatchObject({ outcome: "unknown" });
});

test.each(["rejected", "failed", "unknown", "superseded"])("answers %s literally across independently loaded runtime modules", async status => {
  vi.resetModules();
  const other = await import("./program.js");
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProduction({ flags: undefined, node,
    program: defineProgram<undefined, number, { type: "answer" }, never>({
      init: () => [0, []],
      update: model => [model, [other.reply({ status })]],
      view: model => h("output", {}, String(model)),
    }),
  });
  await expect(mounted.call({ type: "answer" })).resolves.toEqual({ status });
  mounted.stop();
});

test("a subscription can call during setup and see its rendered reply before the next effect", async () => {
  type Msg = { type: "answer" };
  let pending: Promise<unknown> | undefined;
  const node = document.createElement("output");
  document.body.append(node);
  const subscription = { key: "setup", subscribe: (_send: (message: Msg) => void, context: SubscriptionContext<Msg>) => {
    pending = context.call({ type: "answer" });
    return () => { /* no resource */ };
  } };
  const mounted = mountProduction({ flags: undefined, node,
    program: defineProgram<undefined, number, Msg, { type: "inspect" }>({
      init: () => [0, []],
      update: model => [model, [reply("ready"), { type: "inspect" }]],
      view: model => h("output", {}, String(model)),
      subscriptions: () => [subscription],
    }),
    runEffect: () => { expect(node.textContent).toBe("0"); },
  });
  await expect(required(pending)).resolves.toBe("ready");
  mounted.stop();
});
