import { afterEach, expect, test, vi } from "vitest";
import { clicked, defineProgram, h } from "./index.js";
import { mountProgram } from "./testing.js";

type TrackedEvent = { type: string; listener: EventListenerOrEventListenerObject | null };
type TrackedElement = Element & { events?: Array<TrackedEvent> };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test.each([true, false])("native dispatch coexists with external event arrays (track before native: %s)", async trackFirst => {
  // Keep the native methods so the wrapper can forward each element as this.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const add = Element.prototype.addEventListener;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const remove = Element.prototype.removeEventListener;
  vi.spyOn(Element.prototype, "addEventListener").mockImplementation(function (this: TrackedElement, type, listener, options) {
    if (!trackFirst) add.call(this, type, listener, options);
    this.events ??= [];
    this.events.push({ type, listener });
    if (trackFirst) add.call(this, type, listener, options);
  });
  const removedListeners: Array<EventListener> = [];
  vi.spyOn(Element.prototype, "removeEventListener").mockImplementation(function (this: TrackedElement, type, listener, options) {
    const index = this.events?.findIndex(event => event.type === type && event.listener === listener) ?? -1;
    if (index >= 0) this.events?.splice(index, 1);
    if (typeof listener === "function") removedListeners.push(listener);
    remove.call(this, type, listener, options);
  });

  type Mode = "first" | "second" | "off";
  type Model = { mode: Mode; clicks: Array<string> };
  type Msg = { type: "mode"; mode: Mode } | { type: "click"; handler: string };
  const program = defineProgram<undefined, Model, Msg, never>({
    init: () => [{ mode: "first", clicks: [] }, []],
    update: (model, msg) => [msg.type === "mode"
      ? { ...model, mode: msg.mode }
      : { ...model, clicks: [...model.clicks, msg.handler] }, []],
    view: model => h("div", {}, [
      h("button", { id: "existing", onclick: model.mode === "off" ? undefined : clicked({ type: "click", handler: model.mode }) }, "Click"),
      h("button", { id: "new", onclick: clicked({ type: "click", handler: "new" }) }, "New"),
    ]),
  });
  const node = document.createElement("div");
  node.innerHTML = '<button id="existing">Click</button><button id="new">New</button>';
  const existing = node.firstElementChild as HTMLButtonElement & TrackedElement;
  const sentinel = { type: "external", listener: vi.fn() };
  const externalEvents = [sentinel];
  existing.events = externalEvents;
  document.body.append(node);
  const mounted = mountProgram({ node, flags: undefined, program });
  try {
    await mounted.settle();
    expect(node.querySelector("#existing")).toBe(existing);
    existing.click();
    await mounted.settle();
    expect(mounted.model().clicks).toEqual(["first"]);

    mounted.dispatch({ type: "mode", mode: "second" });
    await mounted.settle();
    existing.click();
    await mounted.settle();
    expect(mounted.model().clicks).toEqual(["first", "second"]);
    expect(existing.events).toBe(externalEvents);
    expect(externalEvents).toHaveLength(2);

    mounted.dispatch({ type: "mode", mode: "off" });
    await mounted.settle();
    existing.click();
    expect(mounted.model().clicks).toEqual(["first", "second"]);
    expect(externalEvents).toEqual([sentinel]);
    // Instrumentation may retain a removed listener. A late call must not dispatch the old handler.
    for (const listener of removedListeners) listener.call(existing, new Event("click"));
    expect(mounted.model().clicks).toEqual(["first", "second"]);

    mounted.dispatch({ type: "mode", mode: "first" });
    await mounted.settle();
    existing.click();
    const newButton = node.querySelector<HTMLButtonElement>("#new");
    if (newButton === null) throw new Error("Missing new button");
    newButton.click();
    await mounted.settle();
    expect(mounted.model().clicks).toEqual(["first", "second", "first", "new"]);
    expect(existing.events).toBe(externalEvents);
    expect(externalEvents[0]).toBe(sentinel);
    expect(externalEvents).toHaveLength(2);
  } finally {
    mounted.stop();
  }
});
