import { expect, test, vi } from "vitest";
import { defineProgram, h, type ProgramMsg } from "./program.js";
import { mountProgram } from "./testing.js";
import { liveSubscription, type LiveTransport } from "./live.js";

test("fixed slots preserve a live stream and its captured options through Program updates", async () => {
  const starts = vi.fn(); const firstDispose = vi.fn(); const ends = vi.fn();
  let send: (value: IteratorResult<string>) => void = () => { throw new Error("No pending read"); };
  const open: LiveTransport<string, number> = (cursor, signal, opened) => {
    starts(cursor); opened();
    signal.addEventListener("abort", () => { ends(); send({ done: true, value: undefined }); });
    return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(resolve => { send = resolve; }) }) };
  };
  const node = document.createElement("output"); document.body.append(node);
  const mounted = mountProgram({
    node, flags: undefined,
    program: defineProgram<undefined, { count: number; earlier: boolean; live: boolean }, ProgramMsg, never>({
      init: () => [{ count: 0, earlier: false, live: true }, []],
      update: (model, message) => [{
        ...model, count: model.count + 1,
        earlier: message.type === "toggle" ? !model.earlier : model.earlier,
        live: message.type !== "done",
      }, []],
      view: model => h("output", {}, String(model.count)),
      subscriptions: model => [
        model.earlier && { key: "earlier", subscribe: () => firstDispose },
        model.live && liveSubscription({
          key: "feed", after: model.count, open,
          decode: () => ({ message: { type: model.count === 0 ? "done" : "wrong-closure" } }),
          connected: () => ({ type: "connected" }),
          retry: { initialMs: 1000, maxMs: 1000, resetOn: "open" },
        }),
      ],
    }),
  });
  try {
    await Promise.resolve(); await Promise.resolve();
    mounted.dispatch({ type: "toggle" }); mounted.dispatch({ type: "toggle" });
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(starts).toHaveBeenCalledTimes(1); expect(starts).toHaveBeenCalledWith(0);
    expect(ends).not.toHaveBeenCalled();
    send({ done: false, value: "final" });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mounted.model().live).toBe(false);
    expect(ends).toHaveBeenCalledTimes(1);
  } finally { mounted.stop(); node.remove(); }
});
