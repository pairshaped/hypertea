import { describe, expect, test } from "vitest";

import { defineProgram, h } from "./index.js";
import { mountProgram } from "./testing.js";

describe("controlled program effects", () => {
  test("captures effects for deliberate out-of-order completion", async () => {
    type Model = Readonly<{
      activeRequest: string | undefined;
      result: string;
    }>;
    type Msg =
      | Readonly<{ type: "request"; id: string }>
      | Readonly<{ type: "completed"; id: string; result: string }>;
    type Effect = Readonly<{ type: "load"; id: string }>;
    const program = defineProgram<undefined, Model, Msg, Effect>({
      init: () => [{ activeRequest: undefined, result: "initial" }, []],
      update: (model, message) => {
        switch (message.type) {
          case "request":
            return [
              { ...model, activeRequest: message.id },
              [{ type: "load", id: message.id }],
            ];
          case "completed":
            return message.id === model.activeRequest
              ? [{ activeRequest: undefined, result: message.result }, []]
              : [model, []];
        }
      },
      view: (model) => h("output", {}, model.result),
    });
    const node = document.createElement("output");
    document.body.append(node);
    const mounted = mountProgram({ flags: undefined, node, program });
    await mounted.settle();

    mounted.dispatch({ type: "request", id: "A" });
    mounted.dispatch({ type: "request", id: "B" });
    await mounted.settle();

    const snapshot = mounted.effects();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.map((pending) => pending.effect)).toEqual([
      { type: "load", id: "A" },
      { type: "load", id: "B" },
    ]);
    expect(mounted.takeEffect(20)).toBeUndefined();

    const second = required(mounted.takeEffect(1));
    second.dispatch({ type: "completed", id: second.effect.id, result: "second" });
    await mounted.settle();
    expect(mounted.model().result).toBe("second");
    expect(node.textContent).toBe("second");

    const first = required(mounted.takeEffect());
    first.dispatch({ type: "completed", id: first.effect.id, result: "first" });
    await mounted.settle();
    expect(mounted.model().result).toBe("second");
    expect(mounted.effects()).toEqual([]);

    mounted.dispatch({ type: "request", id: "C" });
    const late = required(mounted.takeEffect());
    mounted.stop();
    late.dispatch({ type: "completed", id: late.effect.id, result: "late" });
    await mounted.settle();

    expect(mounted.model().activeRequest).toBe("C");
    expect(node.textContent).toBe("second");
  });
});

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error("Expected a pending effect");
  }
  return value;
}
