#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import ts from "typescript";
import { generateWebMCPSchemas } from "../dist/webmcp-generate.js";

const { values } = parseArgs({
  options: {
    project: { type: "string" }, source: { type: "string" }, output: { type: "string" }, check: { type: "boolean", default: false },
  }
});
if (!values.project || !values.source || !values.output) {
  throw new Error("Usage: hypertea-webmcp --project tsconfig.json --source messages.ts --output messages.generated.ts [--check]");
}
const project = resolve(values.project);
const source = resolve(values.source);
const output = resolve(values.output);
if (source === output) throw new Error("Generated output must be a separate file");
const config = ts.readConfigFile(project, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, dirname(project));
const errors = [...(config.error ? [config.error] : []), ...parsed.errors];
if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
  getCanonicalFileName: (file) => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n",
}));
const program = ts.createProgram([source], parsed.options);
const schemas = generateWebMCPSchemas(program, source);
// Object-literal __proto__ has special JavaScript semantics; JSON property names do not.
const serialized = JSON.stringify(schemas, null, 2).replace(/^(\s*)"__proto__":/gm, '$1["__proto__"]:');
const content = `// Do not edit. Regenerate from the message type and exposeMessages allowlist.\nimport type { WebMCPInputSchema } from "@pairshaped/hypertea/webmcp";\n\nexport default ${serialized} satisfies Readonly<Record<string, WebMCPInputSchema>>;\n`;
let previous;
try { previous = await readFile(output, "utf8"); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous !== content) {
  if (values.check) throw new Error(`Stale WebMCP schemas: regenerate ${values.output}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content);
}
