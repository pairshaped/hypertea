import { afterEach, expect, test } from "vitest";
import { fragment, h, start, type ProgramHandle, type VNode } from "./index.js";

let mounted: ProgramHandle<number, { type: "set"; value: number }> | undefined;
afterEach(() => { mounted?.stop(); mounted = undefined; document.body.replaceChildren(); });

test.each([0, 1])("fragment children render, insert, update and remove (initial %i)", async initial => {
  const node = document.createElement("div"); document.body.append(node);
  mounted = start({
    node, init: () => [initial, []], update: (_model, message) => [message.value, []],
    view: value => h("main", {}, "before", value === 0 ? undefined : h(fragment, {}, h("b", {}, String(value)), h(fragment, {}, h("i", {}, "tail"))), "after"),
  });
  await mounted.settle();
  expect(document.body.textContent).toBe(initial === 0 ? "beforeafter" : "before1tailafter");
  for (const value of [1, 2, 0]) {
    mounted.dispatch({ type: "set", value }); await mounted.settle();
    expect(document.body.textContent).toBe(value === 0 ? "beforeafter" : `before${String(value)}tailafter`);
    expect(document.querySelectorAll("b")).toHaveLength(value === 0 ? 0 : 1);
  }
});

test("typed view roots reject fragment arrays", () => {
  // @ts-expect-error A fragment is an array of children, not one root VNode.
  const view: (value: number) => VNode<number> = value => h(fragment, {}, h("b", {}, String(value)));
  expect(view(1)).toHaveLength(1);
});
