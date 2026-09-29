import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
import { generateWebMCPSchemas } from "./webmcp-generate.js";

function fixture(source: string, overrides: ts.CompilerOptions = {}) {
  const path = resolve("src/message-fixture.ts");
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, exactOptionalPropertyTypes: true, ...overrides };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === path
    ? ts.createSourceFile(file, source, languageVersion, true)
    : read(file, languageVersion, onError, shouldCreateNewSourceFile);
  return { path, program: ts.createProgram([path], options, host) };
}

test("derives tool names and object inputs only for allowlisted messages", () => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Msg =
      | { type: "add"; amount: number; invocation?: WebMCPInvocation }
      | { type: "loaded"; internal: AbortController };
    exposeMessages<Msg>([{ "message": "add", description: "Add to the counter" }], {});
  `);
  expect(generateWebMCPSchemas(program, path)).toEqual({
    add: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"], additionalProperties: false },
  });
});

test("preserves nested payloads, optional fields, readonly arrays and alternative message inputs", () => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Msg = Readonly<{ type: "filter"; invocation?: WebMCPInvocation; enabled?: boolean } & (
      { choices: readonly ("league" | "event")[]; range: { limit: number; label: string | null } }
      | { path: string; version: 1 }
    )>;
    exposeMessages<Msg>([{ message: "filter", description: "Filter" }], {});
  `);
  const schemas = generateWebMCPSchemas(program, path);
  expect(schemas.filter).toMatchObject({
    type: "object", anyOf: [
      { properties: { enabled: { type: "boolean" }, choices: { type: "array", items: { anyOf: [{ const: "league" }, { const: "event" }] } }, range: { type: "object" } }, required: ["choices", "range"] },
      { properties: { path: { type: "string" }, version: { const: 1 } }, required: ["path", "version"] },
    ]
  });
});

test.each([
  ["any", /Unsupported/], ["unknown", /Unsupported/], ["bigint", /Unsupported/],
  ["symbol", /Unsupported/], ["undefined", /Unsupported/], ["never", /Unsupported/],
  ["Date", /Unsupported/], ["() => void", /Unsupported/], ["new () => object", /Unsupported/],
  ["Record<string, string>", /Unsupported/], ["{ [key: number]: string }", /Unsupported/],
  ["[string, number]", /Unsupported/], ["string & { readonly brand: unique symbol }", /Unsupported/],
  ["{ next: Payload }", /Recursive/],
])("rejects unsupported payload %s instead of publishing a weaker schema", (payload, error) => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Payload = ${payload};
    type Msg = { type: "send"; payload: Payload; invocation: WebMCPInvocation };
    exposeMessages<Msg>([{ message: "send", description: "Send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(error);
});

test("accepts an imported alias and rejects invalid invocation fields", () => {
  const { program, path } = fixture(`
    import { exposeMessages as expose } from "./webmcp.js";
    type Msg = { type: "send"; invocation: string };
    expose<Msg>([{ message: "send", description: "Send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/WebMCPInvocation/);
});

test.each([
  ["exposeMessages([], {})", /array literal allowlist/],
  ["exposeMessages<Msg>()", /array literal allowlist/],
  ["exposeMessages<Msg>(selection, {})", /array literal allowlist/],
  ["exposeMessages<Msg>({}, {})", /array literal allowlist/],
  ["exposeMessages<Msg>([...selection], {})", /object literals/],
  ["exposeMessages<Msg>([{ ...selection }], {})", /explicit property names/],
  ['exposeMessages<Msg>([{ ["message"]: "send" }], {})', /explicit property names/],
  ["exposeMessages<Msg>([{ message() {} }], {})", /explicit property names/],
  ['exposeMessages<Msg>([{ message: "send", message: "send" }], {})', /one literal message/],
  ["exposeMessages<Msg>([{ message: name }], {})", /one literal message/],
  ["exposeMessages<Msg>([{ description: description }], {})", /one literal message/],
  ['exposeMessages<Msg>([{ message: "send" }, { message: "send" }], {})', /Duplicate/],
  ['exposeMessages<Msg>([{ message: "missing" }], {})', /Unknown message/],
  ["exposeMessages<Msg>([], {}); exposeMessages<Msg>([], {})", /exactly one/],
  ["(() => {})(); function other() {}; other(); unknownFunction(); (function () {})();", /exactly one/],
  ["function exposeMessages() {}; exposeMessages();", /exactly one/],
])("rejects declarations it cannot statically prove: %s", (declaration, error) => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Msg = { type: "send"; invocation: WebMCPInvocation } | { other: number } | { type: number };
    const selection = { send: {} };
    ${declaration};
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(error);
});

test("reports missing source and missing completion fields", () => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    type Msg = { type: "send" };
    exposeMessages<Msg>([{ message: "send", description: "Send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, "absent.ts")).toThrow(/Source is not/);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/WebMCPInvocation/);
});

test.each([
  'class Payload { value = 1 }',
  'type Payload = { [key: symbol]: string }',
  'declare const key: unique symbol; type Payload = { [key]: string }',
])("rejects nominal or non-JSON object shapes: %s", (declaration) => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    ${declaration}
    type Msg = { type: "send"; payload: Payload; invocation: WebMCPInvocation };
    exposeMessages<Msg>([{ message: "send", description: "Send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/Unsupported/);
});


test.each([
  { strict: false }, { strictNullChecks: false }, { exactOptionalPropertyTypes: false },
])("requires compiler settings that preserve JSON input shapes: %j", (options) => {
  const { program, path } = fixture("", options);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/strictNullChecks.*exactOptionalPropertyTypes/);
});

test("rejects open message records, including when the payload is otherwise valid", () => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Msg = { type: "send"; invocation: WebMCPInvocation; [key: string]: unknown };
    exposeMessages<Msg>([{ message: "send", description: "Send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/Unsupported/);
});


test("generated schemas validate JSON inputs and dispatch independent copies of the selected message", () => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Payload = Readonly<{ enabled: boolean; mode: "one" | "two"; values: readonly number[];
      range: { limit: number; label: string | null }; yes: true; no: false;
      mapped: Record<"x" | "y", number>; nested: { type: string; invocation: string }
    }> & { marker: 1 };
    type Msg = { type: "send"; payload: Payload; invocation: WebMCPInvocation };
    exposeMessages<Msg>([{ message: "send", description: "Send" }], {});
  `);
  const schemas = generateWebMCPSchemas(program, path);
  const [tool] = exposeMessages<{ type: "send"; payload: unknown; invocation: WebMCPInvocation }>([{ message: "send", description: "Send" }], schemas);
  if (tool === undefined) throw new Error("Expected generated tool");
  const invocation = "test" as WebMCPInvocation;
  const payload = { enabled: true, mode: "one", values: [1], range: { limit: 2, label: null }, yes: true, no: false, mapped: { x: 1, y: 2 }, nested: { type: "data", invocation: "data" }, marker: 1 };
  const message = tool.toMessage({ payload }, invocation);
  expect(message).toEqual({ type: "send", invocation, payload });
  payload.values.push(3);
  expect(message.payload).toMatchObject({ values: [1] });
  expect(tool.toMessage({ payload: { ...payload, mode: "two", enabled: false, range: { limit: 1, label: "text" } } }, invocation).type).toBe("send");
  for (const input of [null, [], new Date(), Object.create({ payload }), { payload, extra: true }, { payload, [Symbol("extra")]: true },
    { payload: { ...payload, values: "bad" } }, { payload: { ...payload, values: [NaN] } }, { payload: { ...payload, values: Array(1) } },
    { payload: { ...payload, enabled: 1 } }, { payload: { ...payload, mode: "three" } }, { payload: { ...payload, range: { limit: 2 } } },
    { payload: { ...payload, range: { limit: 2, label: 3 } } }, { payload: { ...payload, mapped: { x: 1 } } },
  ]) expect(() => tool.toMessage(input, invocation)).toThrow(/Invalid input/);
  const record = Object.assign(Object.create(null) as Record<string, unknown>, { payload });
  expect(tool.toMessage(record, invocation).type).toBe("send");
  let reads = 0;
  expect(() => tool.toMessage({ get payload() { return ++reads === 1 ? payload : "changed"; } }, invocation)).toThrow(/Invalid input/);
});

test("rejects stale or missing sidecars before registering any tools", () => {
  type Msg = { type: "send" };
  expect(() => exposeMessages<Msg>([{ message: "send", description: "Send" }], {})).toThrow(/Stale/);
  expect(() => exposeMessages<Msg>([{ message: "send", description: "Send" }], { other: { type: "number" } })).toThrow(/Missing/);
  expect(() => exposeMessages<Msg>([{ message: "send", description: "Send" }, { message: "send", description: "Again" }], { send: { type: "number" } })).toThrow(/Duplicate/);
  expect(exposeMessages<Msg>([], {})).toEqual([]);
});

test.each([
  ['{ message: "typo", description: "Send" }', /typo/],
  ['{ message: "send" }', /description/],
  ['{ message: "send", description: 42 }', /string/],
])("TypeScript rejects invalid tool entries: %s", (entry, error) => {
  const { program, path } = fixture(`
    import { exposeMessages, type WebMCPInvocation } from "./webmcp.js";
    type Msg = { type: "send"; invocation: WebMCPInvocation };
    exposeMessages<Msg>([${entry}], {});
  `);
  const source = program.getSourceFile(path);
  if (source === undefined) throw new Error("Expected fixture source");
  expect(program.getSemanticDiagnostics(source).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")).toMatch(error);
});
