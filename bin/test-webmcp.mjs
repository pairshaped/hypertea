#!/usr/bin/env node
import ts from "typescript";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fallback = process.argv.includes("--fallback");
const session = fallback ? "hypertea-agent" : "hypertea-webmcp";

async function cli(...args) {
  const { stdout } = await exec("playwright-cli", ["--json", ...args], {
    cwd: repositoryRoot,
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}

async function evaluate(expression) {
  const response = await cli(`-s=${session}`, "eval", expression);
  return JSON.parse(response.result);
}

async function callTool(name, params) {
  if (fallback) return evaluate(`async () => window.hyperteaAgent.executeTool(${JSON.stringify(name)}, ${JSON.stringify(params)})`);
  const response = await cli(`-s=${session}`, "webmcp-call", name, `--params=${JSON.stringify(params)}`);
  // The CLI prefixes its JSON tool result with a provenance sentence.
  return JSON.parse(response.result.slice(response.result.indexOf("\n{") + 1));
}

async function toolNames() {
  return evaluate(fallback
    ? "() => window.hyperteaAgent?.getTools().map(tool => tool.name).sort() ?? []"
    : "async () => (await document.modelContext.getTools()).map(tool => tool.name).sort()");
}

const existing = await cli("list");
assert.equal(existing.browsers.length, 0, "Finish existing Playwright sessions before running the WebMCP smoke test");
const output = await mkdtemp(join(tmpdir(), "hypertea-webmcp-"));
const config = join(output, "browser.json");
await writeFile(config, JSON.stringify({
  browser: {
    browserName: "chromium",
    launchOptions: { channel: "chrome", headless: true, args: [fallback ? "--disable-blink-features=WebMCP" : "--enable-experimental-web-platform-features"] },
    contextOptions: { viewport: { width: 1440, height: 1000 } },
  },
}));

const files = new Map(await Promise.all([
  "test/webmcp.html", "dist/program.js", "dist/index.js", "dist/webmcp.js",
].map(async (path) => [`/${path}`, {
  content: await readFile(join(packageRoot, path)),
  type: path.endsWith(".html") ? "text/html" : "text/javascript",
}])));
for (const source of ["test/webmcp-tools.ts", "test/webmcp.generated.ts"]) {
  const compiled = ts.transpileModule(await readFile(join(packageRoot, source), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  files.set(`/${source.replace(/\.ts$/, ".js")}`, { content: compiled.outputText, type: "text/javascript" });
}
const server = createServer((request, response) => {
  const file = files.get(request.url);
  if (file === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": file.type }).end(file.content);
});

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/test/webmcp.html`;
  await cli(`-s=${session}`, "open", url, `--config=${config}`);
  assert.equal(await evaluate("() => typeof document.modelContext"), fallback ? "undefined" : "object", "Browser native WebMCP availability does not match the test mode");
  if (fallback) {
    const catalog = await evaluate("() => JSON.parse(document.getElementById('hypertea-agent-tools').textContent)");
    assert.equal(catalog.global, "hyperteaAgent");
    assert.deepEqual(catalog.tools.map(tool => tool.name), ["add", "save"]);
  } else {
    const tools = await cli(`-s=${session}`, "webmcp-list");
    assert.match(tools.result, /add/);
    assert.match(tools.result, /save/);
  }
  await cli(`-s=${session}`, "screenshot", `--filename=${join(output, "before.png")}`);

  await cli(`-s=${session}`, "click", "text=Add 1");
  assert.deepEqual(await callTool("add", { amount: 2 }), { status: "applied", count: 3 });
  assert.deepEqual(await callTool("save", {}), { status: "applied", saved: 3 });
  assert.deepEqual(await evaluate(`() => ({
    count: document.querySelector('#count').textContent,
    saved: document.querySelector('#saved').textContent,
    error: document.querySelector('#error').textContent,
  })`), { count: "3", saved: "Saved 3", error: "" });
  await cli(`-s=${session}`, "screenshot", `--filename=${join(output, "after.png")}`);

  await cli(`-s=${session}`, "click", "text=Disable tools");
  assert.deepEqual(await toolNames(), []);
  await cli(`-s=${session}`, "click", "text=Enable tools");
  assert.deepEqual(await toolNames(), ["add", "save"]);
  await cli(`-s=${session}`, "click", "text=Stop program");
  assert.deepEqual(await toolNames(), []);
  if (fallback) assert.equal(await evaluate("() => document.getElementById('hypertea-agent-tools') === null"), true);
  const consoleOutput = await cli(`-s=${session}`, "console");
  assert.match(consoleOutput.result, /Errors: 0/);
  const version = await cli(`-s=${session}`, "run-code", "async (page) => page.context().browser().version()");
  console.log(`${fallback ? "JavaScript fallback (native WebMCP disabled)" : "Native WebMCP"} smoke passed on Chrome ${JSON.parse(version.result)}. Screenshots: ${output}`);
} finally {
  try {
    await cli("close-all").catch(() => cli("kill-all"));
    if ((await cli("list")).browsers.length !== 0) await cli("kill-all");
    assert.equal((await cli("list")).browsers.length, 0, "Playwright sessions remain after cleanup");
  } finally {
    server.closeAllConnections();
    if (server.listening) {
      await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  }
}
