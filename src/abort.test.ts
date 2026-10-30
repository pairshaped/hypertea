import { expect, test, vi } from "vitest";
import { anySignal } from "./abort.js";

test("cancels from either lifetime and removes listeners", () => {
  for (const selected of [0, 1]) {
    const controllers = [new AbortController(), new AbortController()];
    const removed = controllers.map(controller => vi.spyOn(controller.signal, "removeEventListener"));
    const combined = anySignal(controllers.map(controller => controller.signal));
    expect(combined.aborted).toBe(false);
    const selectedController = controllers[selected];
    if (selectedController === undefined) throw new Error("missing test controller");
    selectedController.abort("stopped");
    expect(combined.reason).toBe("stopped");
    for (const listener of removed) expect(listener).toHaveBeenCalledOnce();
  }
});
test("accepts already cancelled and empty lifetimes", () => {
  const controller = new AbortController();
  controller.abort("already stopped");
  expect(anySignal([controller.signal]).reason).toBe("already stopped");
  expect(anySignal([]).aborted).toBe(false);
});
