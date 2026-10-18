import { afterEach, expect, test, vi } from "vitest";
import { defineProgram, effectSignal, h, mountProgram, type ProgramHandle } from "./program.js";

const mounts: Array<ProgramHandle<number, { type: "done" }>> = [];
afterEach(() => { mounts.splice(0).forEach(mount => { mount.stop(); }); document.body.replaceChildren(); vi.useRealTimers(); });

test("stopping a connected Program aborts its pending effect once and blocks abort and late dispatch", async () => {
  const node = document.createElement("output"); document.body.append(node);
  const signals: Array<AbortSignal> = [];
  const pending: Array<() => void> = [];
  let aborted = 0;
  const mounted = mountProgram({ node, flags: undefined,
    program: defineProgram<undefined, number, { type: "done" }, { type: "wait" }>({
      init: () => [0, [{ type: "wait" }]],
      update: model => [model + 1, []],
      view: model => h("output", {}, String(model)),
    }),
    runEffect: dispatch => {
      const signal = effectSignal(dispatch);
      if (signal === undefined) throw new Error("Missing effect stop signal");
      signals.push(signal);
      signal.addEventListener("abort", () => { aborted += 1; dispatch({ type: "done" }); }, { once: true });
      return new Promise<void>(resolve => { pending.push(() => { dispatch({ type: "done" }); resolve(); }); });
    },
  });
  mounts.push(mounted);
  await mounted.settle();
  const signal = signals[0]; const finish = pending[0];
  if (signal === undefined || finish === undefined) throw new Error("Missing pending effect");
  expect(signal.aborted).toBe(false);
  mounted.stop(); mounted.stop();
  expect(node.isConnected).toBe(true);
  expect(signal.aborted).toBe(true);
  expect(aborted).toBe(1);
  finish(); await Promise.resolve();
  expect(mounted.model()).toBe(0);
});

test("plain dispatch has no effect signal and the accessor reads global symbol metadata", async () => {
  expect(effectSignal(() => undefined)).toBeUndefined();
  const other = await import("./index.js");
  const signal = new AbortController().signal;
  expect(other.effectSignal({ [Symbol.for("hypertea.effect.signal.v1")]: signal })).toBe(signal);
});

test("a legacy runner can finish its resource work after stop while its dispatch stays blocked", async () => {
  let finish: () => void = () => { throw new Error("Missing pending operation"); };
  let completed = false;
  const mounted = mountProgram({ node: document.createElement("output"), flags: undefined,
    program: defineProgram<undefined, number, { type: "done" }, { type: "wait" }>({
      init: () => [0, [{ type: "wait" }]], update: model => [model + 1, []], view: model => h("output", {}, String(model)),
    }),
    runEffect: async dispatch => {
      await new Promise<void>(resolve => { finish = resolve; });
      completed = true; dispatch({ type: "done" });
    },
  });
  mounts.push(mounted); mounted.stop();
  expect(completed).toBe(false);
  finish(); await Promise.resolve();
  expect(completed).toBe(true);
  expect(mounted.model()).toBe(0);
});

for (const completion of ["sync", "async", "throw", "reject"] as const) {
  test(`completed ${completion} runners are not aborted by later stop`, async () => {
    const signals: Array<AbortSignal> = [];
    const mounted = mountProgram({ node: document.createElement("output"), flags: undefined,
      program: defineProgram<undefined, number, { type: "done" }, { type: "wait" }>({
        init: () => [0, []], update: model => [model + 1, [{ type: "wait" }]],
        view: model => h("output", {}, String(model)),
      }),
      runEffect: dispatch => {
        const signal = effectSignal(dispatch);
        if (signal === undefined) throw new Error("Missing effect signal");
        signals.push(signal);
        if (completion === "throw") throw new Error("synchronous failure");
        if (completion === "reject") return Promise.reject(new Error("asynchronous failure"));
        if (completion === "async") return Promise.resolve();
        return;
      },
    });
    mounts.push(mounted);
    // Both successful and failed unanswered calls retire with an unknown outcome.
    await expect(mounted.call({ type: "done" })).rejects.toMatchObject({ outcome: "unknown" });
    const signal = signals[0];
    if (signal === undefined) throw new Error("Runner did not start");
    mounted.stop();
    expect(signal.aborted).toBe(false);
  });
}

test("human synchronous completion and failure release their effect lifetime", () => {
  const signals: Array<AbortSignal> = [];
  const mounted = mountProgram({ node: document.createElement("output"), flags: undefined,
    program: defineProgram<undefined, number, { type: "done" }, { type: "wait" }>({
      init: () => [0, []], update: model => [model + 1, [{ type: "wait" }]], view: model => h("output", {}, String(model)),
    }),
    runEffect: dispatch => {
      const signal = effectSignal(dispatch);
      if (signal === undefined) throw new Error("Missing effect signal");
      signals.push(signal);
      if (signals.length === 2) throw new Error("runner failed");
    },
  });
  mounts.push(mounted);
  mounted.dispatch({ type: "done" });
  expect(() => { mounted.dispatch({ type: "done" }); }).toThrow("runner failed");
  mounted.stop();
  expect(signals).toHaveLength(2);
  expect(signals.map(signal => signal.aborted)).toEqual([false, false]);
});

test("stop clears an adapter timer without stopping another Program's work", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const create = () => {
    const node = document.createElement("output"); document.body.append(node);
    const mounted = mountProgram({ node, flags: undefined,
      program: defineProgram<undefined, number, { type: "done" }, { type: "wait" }>({
        init: () => [0, [{ type: "wait" }]], update: model => [model + 1, []], view: model => h("output", {}, String(model)),
      }),
      runEffect: dispatch => new Promise<void>(resolve => {
        const signal = effectSignal(dispatch);
        if (signal === undefined) throw new Error("Missing effect signal");
        const timer = setTimeout(() => { dispatch({ type: "done" }); resolve(); }, 100);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      }),
    });
    mounts.push(mounted); return mounted;
  };
  const stopped = create(); const live = create();
  stopped.stop();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(stopped.model()).toBe(0);
  expect(live.model()).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("a stop inside a runner marks subsequent legacy runners inactive without skipping them", () => {
  let stop: () => void = () => { throw new Error("Program not mounted"); };
  const signals: Array<AbortSignal> = [];
  const mounted = mountProgram({ node: document.createElement("output"), flags: undefined,
    program: defineProgram<undefined, number, { type: "done" }, { type: "wait" }>({
      init: () => [0, []], update: model => [model + 1, [{ type: "wait" }, { type: "wait" }]], view: model => h("output", {}, String(model)),
    }),
    runEffect: dispatch => {
      const signal = effectSignal(dispatch);
      if (signal === undefined) throw new Error("Missing effect signal");
      signals.push(signal); stop();
    },
  });
  mounts.push(mounted); stop = mounted.stop;
  mounted.dispatch({ type: "done" });
  expect(signals).toHaveLength(2);
  expect(signals.map(signal => signal.aborted)).toEqual([true, true]);
});
