import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { hyperteaPurity } from "../eslint-purity.js";

const purityConfig = hyperteaPurity({
  files: ["src/**/*.ts"],
  effectFiles: ["src/effects/**/*.ts"],
});

function lint(code: string, filename = "src/update.ts"): ReadonlyArray<Linter.LintMessage> {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(code, purityConfig, { filename });
}

function lintEntry(code: string): ReadonlyArray<Linter.LintMessage> {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    hyperteaPurity({
      files: ["src/**/*.ts"],
      allowedGlobals: ["document"],
    }),
    { filename: "src/entry.ts" },
  );
}

describe("hyperteaPurity", () => {
  it("rejects a raw side effect hidden in an ordinary helper", () => {
    const messages = lint(`
      export async function load() {
        return fetch("/items");
      }
    `);

    expect(messages.map(({ ruleId }) => ruleId)).toContain("no-restricted-globals");
  });

  it("rejects qualified browser, time, and randomness access", () => {
    const messages = lint(`
      export function inspect() {
        return [
          globalThis.document.title,
          Date.now(),
          Math.random(),
          globalThis.Date.now(),
          globalThis.Math.random(),
        ];
      }
    `);

    expect(messages.filter(({ ruleId }) => ruleId === "no-restricted-syntax")).toHaveLength(5);
  });

  it("allows declared effect adapter files to own side effects", () => {
    const messages = lint(
      `export const load = () => fetch(globalThis.document.location.href);`,
      "src/effects/http.ts",
    );

    expect(messages).toHaveLength(0);
  });

  it("supports a documented entry-module global without opening other effects", () => {
    const messages = lintEntry(`
      document.querySelector("[data-app]");
      fetch("/items");
    `);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("no-restricted-globals");
  });

  it("preserves application-specific syntax restrictions", () => {
    const linter = new Linter({ configType: "flat" });
    const messages = linter.verify(
      "let count = 0; count = 1;",
      hyperteaPurity({
        files: ["src/**/*.ts"],
        extraRestrictedSyntax: [
          {
            selector: "AssignmentExpression",
            message: "Return a new value instead of mutating.",
          },
        ],
      }),
      { filename: "src/update.ts" },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("no-restricted-syntax");
  });

  it("allows a narrow documented exception", () => {
    const messages = lint(`
      export function report() {
        // eslint-disable-next-line no-restricted-globals -- Error reporting is the boundary in this tiny adapter.
        console.error("failed");
      }
    `);

    expect(messages).toHaveLength(0);
  });

  it("leaves pure application code alone", () => {
    const messages = lint(`
      export function update(count, amount) {
        return count + amount;
      }
    `);

    expect(messages).toHaveLength(0);
  });

  it("requires an ordinary file pattern", () => {
    expect(() => hyperteaPurity({ files: [] })).toThrow(
      "hyperteaPurity requires at least one file pattern",
    );
  });
});
