#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const session = "hypertea-webmcp";

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
  const response = await cli(`-s=${session}`, "webmcp-call", name, `--params=${JSON.stringify(params)}`);
  // The CLI prefixes its JSON tool result with a provenance sentence.
  return JSON.parse(response.result.slice(response.result.indexOf("\n{") + 1));
}

const existing = await cli("list");
assert.equal(existing.browsers.length, 0, "Finish existing Playwright sessions before running the native smoke test");
const output = await mkdtemp(join(tmpdir(), "hypertea-webmcp-"));
const config = join(output, "browser.json");
await writeFile(config, JSON.stringify({
  browser: {
    browserName: "chromium",
    launchOptions: { channel: "chrome", headless: true, args: ["--enable-experimental-web-platform-features"] },
    contextOptions: { viewport: { width: 1440, height: 1000 } },
  },
}));

const files = new Map(await Promise.all([
  "test/webmcp.html", "dist/program.js", "dist/index.js", "dist/webmcp.js",
].map(async (path) => [`/${path}`, {
  content: await readFile(join(packageRoot, path)),
  type: path.endsWith(".html") ? "text/html" : "text/javascript",
}])));
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
  assert.equal(await evaluate("() => typeof document.modelContext"), "object", "This Chrome build does not expose document.modelContext");
  const tools = await cli(`-s=${session}`, "webmcp-list");
  assert.match(tools.result, /add_counter/);
  assert.match(tools.result, /save_counter/);
  await cli(`-s=${session}`, "screenshot", `--filename=${join(output, "before.png")}`);

  await cli(`-s=${session}`, "click", "text=Add 1");
  assert.deepEqual(await callTool("add_counter", { amount: 2 }), { status: "applied", count: 3 });
  assert.deepEqual(await callTool("save_counter", {}), { status: "applied", saved: 3 });
  assert.deepEqual(await evaluate(`() => ({
    count: document.querySelector('#count').textContent,
    saved: document.querySelector('#saved').textContent,
    error: document.querySelector('#error').textContent,
  })`), { count: "3", saved: "Saved 3", error: "" });
  await cli(`-s=${session}`, "screenshot", `--filename=${join(output, "after.png")}`);

  await cli(`-s=${session}`, "click", "text=Disable tools");
  assert.deepEqual(await evaluate("async () => (await document.modelContext.getTools()).map(tool => tool.name)"), []);
  await cli(`-s=${session}`, "click", "text=Enable tools");
  assert.deepEqual(await evaluate("async () => (await document.modelContext.getTools()).map(tool => tool.name).sort()"), ["add_counter", "save_counter"]);
  await cli(`-s=${session}`, "click", "text=Stop program");
  assert.deepEqual(await evaluate("async () => (await document.modelContext.getTools()).map(tool => tool.name)"), []);
  const consoleOutput = await cli(`-s=${session}`, "console");
  assert.match(consoleOutput.result, /Errors: 0/);
  const version = await cli(`-s=${session}`, "run-code", "async (page) => page.context().browser().version()");
  console.log(`Native WebMCP smoke passed on Chrome ${JSON.parse(version.result)}. Screenshots: ${output}`);
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
