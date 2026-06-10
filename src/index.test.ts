import { describe, expect, test } from "vitest";

import { assertNever, noEffect } from "./index.js";

describe("noEffect", () => {
  test("creates an empty managed effect", () => {
    expect(noEffect()).toEqual({ kind: "none" });
  });
});

describe("assertNever", () => {
  test("throws with the unhandled value in the message", () => {
    expect(() => assertNever("missing" as never)).toThrow(
      'Unhandled message: "missing"',
    );
  });
});
