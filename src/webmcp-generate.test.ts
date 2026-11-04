import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

import { exposeMessages } from "./webmcp.js";
import { generateWebMCPSchemas } from "./webmcp-generate.js";

function fixture(source: string, overrides: ts.CompilerOptions = {}, files: Readonly<Record<string, string>> = {}) {
  const path = resolve("src/message-fixture.ts");
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, exactOptionalPropertyTypes: true, ...overrides };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  const exists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = directory => Object.keys(files).some(file => file.startsWith(`${resolve(directory)}/`)) || directoryExists?.(directory) === true;
  host.fileExists = file => Object.hasOwn(files, file) || exists(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === path
    ? ts.createSourceFile(file, source, languageVersion, true)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Own-key check establishes the virtual source.
    : Object.hasOwn(files, file) ? ts.createSourceFile(file, files[file]!, languageVersion, true) : read(file, languageVersion, onError, shouldCreateNewSourceFile);
  return { path, program: ts.createProgram([path], options, host) };
}

test("derives tool names and object inputs only for allowlisted messages", () => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    type Msg =
      | { type: "add"; amount: number }
      | { type: "loaded"; internal: AbortController };
    exposeMessages<Msg>([{ "message": "add" }], {});
  `);
  expect(generateWebMCPSchemas(program, path)).toEqual({
    add: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"], additionalProperties: false },
  });
});

test("preserves nested payloads, optional fields, readonly arrays and alternative message inputs", () => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    type Msg = Readonly<{ type: "filter"; enabled?: boolean } & (
      { choices: readonly ("league" | "event")[]; range: { limit: number; label: string | null } }
      | { path: string; version: 1 }
    )>;
    exposeMessages<Msg>([{ message: "filter" }], {});
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
    import { exposeMessages } from "./webmcp.js";
    type Payload = ${payload};
    type Msg = { type: "send"; payload: Payload };
    exposeMessages<Msg>([{ message: "send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(error);
});

test("accepts an imported alias and treats root invocation as ordinary input", () => {
  const { program, path } = fixture(`
    import { exposeMessages as expose } from "./webmcp.js";
    type Msg = { type: "send"; invocation: string };
    expose<Msg>([{ message: "send" }], {});
  `);
  const schemas = generateWebMCPSchemas(program, path);
  expect(schemas).toEqual({ send: { type: "object", properties: { invocation: { type: "string" } }, required: ["invocation"], additionalProperties: false } });
  const [tool] = exposeMessages<{ type: "send"; invocation: string }>([{ message: "send" }], schemas);
  if (tool === undefined) throw new Error("Expected generated tool");
  expect(tool.toMessage({ invocation: "application data" })).toEqual({ type: "send", invocation: "application data" });
  expect(() => tool.toMessage({})).toThrow(/Invalid input/);
  expect(() => tool.toMessage({ invocation: 1 })).toThrow(/Invalid input/);
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
    import { exposeMessages } from "./webmcp.js";
    type Msg = { type: "send" } | { other: number } | { type: number };
    const selection = { send: {} };
    ${declaration};
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(error);
});

test("reports missing source and supports messages without input fields", () => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    type Msg = { type: "send" };
    exposeMessages<Msg>([{ message: "send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, "absent.ts")).toThrow(/Source is not/);
  expect(generateWebMCPSchemas(program, path)).toEqual({ send: { type: "object", properties: {}, required: [], additionalProperties: false } });
});

test.each([
  'class Payload { value = 1 }',
  'type Payload = { [key: symbol]: string }',
  'declare const key: unique symbol; type Payload = { [key]: string }',
])("rejects nominal or non-JSON object shapes: %s", (declaration) => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    ${declaration}
    type Msg = { type: "send"; payload: Payload };
    exposeMessages<Msg>([{ message: "send" }], {});
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
    import { exposeMessages } from "./webmcp.js";
    type Msg = { type: "send"; [key: string]: unknown };
    exposeMessages<Msg>([{ message: "send" }], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/Unsupported/);
});

test("generated schemas validate JSON inputs and dispatch independent copies of the selected message", () => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    type Payload = Readonly<{ enabled: boolean; mode: "one" | "two"; values: readonly number[];
      range: { limit: number; label: string | null }; yes: true; no: false;
      mapped: Record<"x" | "y", number>; nested: { type: string; invocation: string }
    }> & { marker: 1 };
    type Msg = { type: "send"; payload: Payload };
    exposeMessages<Msg>([{ message: "send" }], {});
  `);
  const schemas = generateWebMCPSchemas(program, path);
  const [tool] = exposeMessages<{ type: "send"; payload: unknown }>([{ message: "send" }], schemas);
  if (tool === undefined) throw new Error("Expected generated tool");
  const payload = { enabled: true, mode: "one", values: [1], range: { limit: 2, label: null }, yes: true, no: false, mapped: { x: 1, y: 2 }, nested: { type: "data", invocation: "data" }, marker: 1 };
  const message = tool.toMessage({ payload });
  expect(message).toEqual({ type: "send", payload });
  payload.values.push(3);
  expect(message.payload).toMatchObject({ values: [1] });
  expect(tool.toMessage({ payload: { ...payload, mode: "two", enabled: false, range: { limit: 1, label: "text" } } }).type).toBe("send");
  for (const input of [null, [], new Date(), Object.create({ payload }), { payload, extra: true }, { payload, [Symbol("extra")]: true },
    { payload: { ...payload, values: "bad" } }, { payload: { ...payload, values: [NaN] } }, { payload: { ...payload, values: Array(1) } },
    { payload: { ...payload, enabled: 1 } }, { payload: { ...payload, mode: "three" } }, { payload: { ...payload, range: { limit: 2 } } },
    { payload: { ...payload, range: { limit: 2, label: 3 } } }, { payload: { ...payload, mapped: { x: 1 } } },
  ]) expect(() => tool.toMessage(input)).toThrow(/Invalid input/);
  const record = Object.assign(Object.create(null) as Record<string, unknown>, { payload });
  expect(tool.toMessage(record).type).toBe("send");
  let reads = 0;
  expect(() => tool.toMessage({ get payload() { return ++reads === 1 ? payload : "changed"; } })).toThrow(/Invalid input/);
});

test("rejects stale or missing sidecars before registering any tools", () => {
  type Msg = { type: "send" };
  expect(() => exposeMessages<Msg>([{ message: "send" }], {})).toThrow(/Stale/);
  expect(() => exposeMessages<Msg>([{ message: "send" }], { other: { type: "number" } })).toThrow(/Missing/);
  expect(() => exposeMessages<Msg>([{ message: "send" }, { message: "send" }], { send: { type: "number" } })).toThrow(/Duplicate/);
  expect(exposeMessages<Msg>([], {})).toEqual([]);
});

test.each([
  ['{ message: "typo" }', /typo/],
  ['{ message: "send", title: 42 }', /string/],
])("TypeScript rejects invalid tool entries: %s", (entry, error) => {
  const { program, path } = fixture(`
    import { exposeMessages } from "./webmcp.js";
    type Msg = { type: "send" };
    exposeMessages<Msg>([${entry}], {});
  `);
  const source = program.getSourceFile(path);
  if (source === undefined) throw new Error("Expected fixture source");
  expect(program.getSemanticDiagnostics(source).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")).toMatch(error);
});


test.each([
  'import type { WebMCPValue } from "./webmcp.js";',
  'import type { WebMCPValue as Json } from "./webmcp.js"; type WebMCPValue = Json;',
  'import type { Json as WebMCPValue } from "./json-reexport.js";',
])("recognizes only canonical JSON through imported aliases and reexports: %s", imports => {
  const {program, path} = fixture(`
    import { exposeMessages } from "./webmcp.js";
    ${imports}
    type Msg = {type: "propose"; operations: readonly {operation: "replace_document"; document: WebMCPValue}[]};
    exposeMessages<Msg>([{message: "propose"}], {});
  `, {}, {[resolve("src/json-reexport.ts")]: 'export type { WebMCPValue as Json } from "./webmcp.js";'});
  expect(generateWebMCPSchemas(program, path)).toEqual({propose: {type: "object", required: ["operations"], additionalProperties: false,
    properties: {operations: {type: "array", items: {type: "object", required: ["operation", "document"], additionalProperties: false,
      properties: {operation: {const: "replace_document"}, document: {"x-hypertea-json-value": true}}}}}}});
});

test.each([
  'type WebMCPValue = string | number | boolean | null | readonly WebMCPValue[] | {readonly [key:string]: WebMCPValue};',
  'import type { WebMCPValue } from "./spoof/webmcp.js";',
])("rejects a spoofed canonical JSON declaration: %s", declaration => {
  const {program, path} = fixture(`
    import { exposeMessages } from "./webmcp.js";
    ${declaration}
    type Msg = {type: "send"; payload: WebMCPValue};
    exposeMessages<Msg>([{message: "send"}], {});
  `, {}, {[resolve("src/spoof/webmcp.ts")]: 'export type WebMCPValue = string | null | readonly WebMCPValue[];'});
  if (declaration.startsWith("import")) expect(program.getSourceFile(resolve("src/spoof/webmcp.ts"))).toBeDefined();
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/Recursive|Unsupported/);
});


test("unresolved imported JSON names are rejected rather than treated as canonical", () => {
  const {program, path} = fixture(`
    import { exposeMessages } from "./webmcp.js";
    import type { MissingJson } from "./missing-json.js";
    type Msg = {type: "send"; payload: MissingJson};
    exposeMessages<Msg>([{message: "send"}], {});
  `);
  expect(() => generateWebMCPSchemas(program, path)).toThrow(/Unsupported/);
});
