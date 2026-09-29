import { afterEach, describe, expect, test, vi } from "vitest";

import { clicked, defineProgram, h, mountProgram } from "./program.js";
import {
  createWebMCP,
  defineWebMCPTool,
  exposeMessages,
  type WebMCPCompletion,
  type WebMCPInvocation,
  type WebMCPRegisteredTool,
} from "./webmcp.js";

const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "modelContext");
  Reflect.deleteProperty(window, "hyperteaAgent");
  document.getElementById("hypertea-agent-tools")?.remove();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function installBrowser(registerResult: () => Promise<void> = () => Promise.resolve()) {
  const tools = new Map<string, WebMCPRegisteredTool>();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: (tool: WebMCPRegisteredTool, options: { signal: AbortSignal; }) => {
        if (tools.has(tool.name)) return Promise.reject(new Error("Duplicate tool"));
        tools.set(tool.name, tool);
        options.signal.addEventListener("abort", () => tools.delete(tool.name));
        return registerResult();
      },
    },
  });
  return tools;
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}

function parseAmount(input: unknown): number {
  if (typeof input !== "object" || input === null || !("amount" in input) || typeof input.amount !== "number" || !Number.isFinite(input.amount)) {
    throw new Error("Expected a finite amount");
  }
  return input.amount;
}

function mountAsyncCounter(names: ReadonlyArray<string> = ["save"]) {
  type Msg =
    | Readonly<{ type: "save"; amount: number; invocation: WebMCPInvocation; }>
    | Readonly<{ type: "saved"; amount: number; invocation: WebMCPInvocation; status: string; }>
    | Readonly<{ type: "registrationFailed"; error: unknown; }>
    | Readonly<{ type: "replaceTools"; }>
    | Readonly<{ type: "enable"; enabled: boolean; }>;
  type Save = Readonly<{ type: "save"; amount: number; invocation: WebMCPInvocation; }>;
  type Model = Readonly<{ count: number; enabled: boolean; alternate: boolean; error: string; }>;
  const saves: Array<Save> = [];
  const bridge = createWebMCP<Msg>({ onRegistrationError: (error) => ({ type: "registrationFailed", error }) });
  const declarations = names.map((name) => defineWebMCPTool({
    name,
    description: "Save a counter value",
    inputSchema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
    parseInput: parseAmount,
    toMessage: (amount, invocation): Msg => ({ type: "save", amount, invocation }),
  }));
  const alternate = declarations.map((tool) => ({ ...tool, name: `${tool.name}_alternate` }));
  const program = defineProgram<undefined, Model, Msg, Save | WebMCPCompletion>({
    init: () => [{ count: 0, enabled: true, alternate: false, error: "" }, []],
    update: (model, message) => {
      switch (message.type) {
        case "save": {
          if (message.amount < 0) throw new Error("Application failure");
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- Model an untyped application throwing a non-Error value.
          if (message.amount === 13) throw "Application failure";
          return [model, [message]];
        }
        case "saved": return [{ ...model, count: message.amount }, [{
          type: "webmcp.complete", invocation: message.invocation,
          result: { status: message.status, count: message.amount },
        }]];
        case "enable": return [{ ...model, enabled: message.enabled }, []];
        case "replaceTools": return [{ ...model, alternate: true }, []];
        case "registrationFailed": return [{ ...model, error: String(message.error) }, []];
      }
    },
    view: (model) => h("output", {}, String(model.count)),
    subscriptions: (model) => model.enabled ? [bridge.subscription(model.alternate ? alternate : declarations)] : [],
  });
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProgram({
    node, flags: undefined, program, runEffect: (_dispatch, effect) => {
      if (effect.type === "save") {
        saves.push(effect);
        return;
      }
      return bridge.complete(effect);
    }
  });
  stops.push(mounted.stop);
  return { mounted, node, saves, bridge };
}

describe("WebMCP program integration", () => {
  test("registering tools exposes a catalog and completes calls without native WebMCP", async () => {
    const { mounted, node, saves } = mountAsyncCounter();
    const agent = required(window.hyperteaAgent);
    const catalog = document.querySelector('script#hypertea-agent-tools[type="application/json"]');
    expect(JSON.parse(catalog?.textContent ?? "{}")).toMatchObject({
      version: 1, global: "hyperteaAgent", tools: [{ name: "save" }],
    });
    expect(agent.getTools().map((tool) => tool.name)).toEqual(["save"]);
    const pending = agent.executeTool("save", { amount: 4 });
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "applied" });
    expect(await pending).toEqual({ status: "applied", count: 4 });
    expect(node.textContent).toBe("4");
    mounted.stop();
    expect(window.hyperteaAgent).toBeUndefined();
    expect(document.getElementById("hypertea-agent-tools")).toBeNull();
  });

  test("another program cannot overwrite an exposed agent", async () => {
    const first = mountAsyncCounter();
    const agent = required(window.hyperteaAgent);
    const second = mountAsyncCounter();
    await second.mounted.settle();
    expect(second.mounted.model().error).toMatch(/Duplicate tool/);
    expect(window.hyperteaAgent).toBe(agent);
    second.mounted.stop();
    const pending = agent.executeTool("save", { amount: 5 });
    first.mounted.dispatch({ ...required(first.saves[0]), type: "saved", status: "applied" });
    expect(await pending).toEqual({ status: "applied", count: 5 });
  });

  test("fallback tool names must be unambiguous even without browser validation", async () => {
    const { mounted } = mountAsyncCounter(["save", "save"]);
    await mounted.settle();
    expect(mounted.model().error).toMatch(/Duplicate tool/);
    expect(window.hyperteaAgent).toBeUndefined();
    expect(document.getElementById("hypertea-agent-tools")).toBeNull();
  });

  test("multiple programs share discovery and remove only their own tools", async () => {
    const native = installBrowser();
    const first = mountAsyncCounter();
    const second = mountAsyncCounter(["other_save"]);
    const agent = required(window.hyperteaAgent);
    expect(agent.getTools().map((tool) => tool.name)).toEqual(["save", "other_save"]);
    first.mounted.stop();
    expect(window.hyperteaAgent).toBe(agent);
    expect(agent.getTools().map((tool) => tool.name)).toEqual(["other_save"]);
    expect([...native.keys()]).toEqual(["other_save"]);
    const result = agent.executeTool("other_save", { amount: 6 });
    second.mounted.dispatch({ ...required(second.saves[0]), type: "saved", status: "applied" });
    expect(await result).toEqual({ status: "applied", count: 6 });
    second.mounted.stop();
    expect(window.hyperteaAgent).toBeUndefined();
    expect(agent.getTools()).toEqual([]);
  });

  test("an empty tool set leaves no agent interface to discover", async () => {
    const { mounted } = mountAsyncCounter([]);
    await mounted.settle();
    expect(window.hyperteaAgent).toBeUndefined();
    expect(document.getElementById("hypertea-agent-tools")).toBeNull();
  });

  test("unknown fallback tools are rejected and catalog snapshots cannot change the declarations", async () => {
    const { saves } = mountAsyncCounter();
    const agent = required(window.hyperteaAgent);
    await expect(agent.executeTool("invented", {})).rejects.toThrow("Unknown Hypertea tool");
    const snapshot = agent.getTools();
    Reflect.set(required(snapshot[0]), "name", "invented");
    expect(agent.getTools().map((tool) => tool.name)).toEqual(["save"]);
    expect(saves).toEqual([]);
  });

  test("an existing catalog is preserved and blocks fallback publication", async () => {
    const catalog = document.createElement("script");
    catalog.id = "hypertea-agent-tools";
    catalog.type = "application/json";
    catalog.textContent = "Existing catalog";
    document.head.append(catalog);
    const { mounted } = mountAsyncCounter();
    await mounted.settle();
    expect(mounted.model().error).toMatch(/already exposed/);
    expect(window.hyperteaAgent).toBeUndefined();
    expect(catalog.textContent).toBe("Existing catalog");
  });

  test("stopping does not delete a global replaced by the host", () => {
    const { mounted } = mountAsyncCounter();
    const replacement = { ...required(window.hyperteaAgent) };
    window.hyperteaAgent = replacement;
    mounted.stop();
    expect(window.hyperteaAgent).toBe(replacement);
    expect(document.getElementById("hypertea-agent-tools")).toBeNull();
  });

  test("documents without a browser window report unavailable agent exposure", async () => {
    vi.stubGlobal("document", document.implementation.createHTMLDocument());
    const { mounted } = mountAsyncCounter();
    await mounted.settle();
    expect(mounted.model().error).toMatch(/requires a browser window/);
  });

  test("native registration failure removes the fallback too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    installBrowser(() => Promise.reject(new Error("Registration failed")));
    const { mounted } = mountAsyncCounter();
    await vi.runAllTimersAsync();
    expect(mounted.model().error).toMatch(/Registration failed/);
    expect(window.hyperteaAgent).toBeUndefined();
    expect(document.getElementById("hypertea-agent-tools")).toBeNull();
  });

  test.each(["abort", "disable", "stop"] as const)("fallback %s cancels waiting without claiming rollback", async (action) => {
    const { mounted, saves } = mountAsyncCounter();
    const agent = required(window.hyperteaAgent);
    const before = new AbortController();
    before.abort();
    await expect(agent.executeTool("save", { amount: 1 }, { signal: before.signal }))
      .rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
    expect(saves).toEqual([]);
    const abort = new AbortController();
    const pending = agent.executeTool("save", { amount: 4 }, { signal: abort.signal });
    const rejected = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    switch (action) {
      case "abort": abort.abort(); break;
      case "disable": mounted.dispatch({ type: "enable", enabled: false }); break;
      case "stop": mounted.stop(); break;
    }
    await rejected;
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "applied" });
    expect(mounted.model().count).toBe(action === "stop" ? 0 : 4);
    if (action !== "abort") expect(window.hyperteaAgent).toBeUndefined();
  });

  test("human and tool actions share an update and tools reply after rendering", async () => {
    const tools = installBrowser();
    type Msg =
      | Readonly<{ type: "add"; amount: number; invocation?: WebMCPInvocation; }>
      | Readonly<{ type: "registrationFailed"; error: unknown; }>;
    const bridge = createWebMCP<Msg>({
      onRegistrationError: (error) => ({ type: "registrationFailed", error }),
    });
    const declarations = [defineWebMCPTool({
      name: "add",
      title: "Add to counter",
      description: "Add to the counter",
      annotations: { consequentialHint: false },
      inputSchema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
      parseInput: parseAmount,
      toMessage: (amount, invocation): Msg => ({ type: "add", amount, invocation }),
    })];
    const program = defineProgram<undefined, number, Msg, WebMCPCompletion>({
      init: () => [0, []],
      update: (count, message) => {
        if (message.type === "registrationFailed") throw message.error;
        const next = count + message.amount;
        return [next, message.invocation === undefined ? [] : [{
          type: "webmcp.complete",
          invocation: message.invocation,
          result: { status: "applied", count: next },
        }]];
      },
      view: (count) => h("button", { onClick: clicked<Msg>({ type: "add", amount: 1 }) }, String(count)),
      subscriptions: () => [bridge.subscription(declarations)],
    });
    const node = document.createElement("button");
    document.body.append(node);
    const mounted = mountProgram({ node, flags: undefined, program, runEffect: (_dispatch, effect) => bridge.complete(effect) });
    stops.push(mounted.stop);
    await mounted.settle();

    node.click();
    await mounted.settle();
    expect(mounted.model()).toBe(1);
    const tool = tools.get("add");
    expect(tool).toMatchObject({ title: "Add to counter", annotations: { consequentialHint: false } });
    const result = await tool?.execute({ amount: 2 }, { signal: new AbortController().signal });
    expect(result).toEqual({ status: "applied", count: 3 });
    expect(node.textContent).toBe("3");
    mounted.stop();
    expect(tools.size).toBe(0);
  });

  test.each(["native", "fallback"] as const)("%s outcomes match the invocation, not the next render or completion", async (transport) => {
    const tools = transport === "native" ? installBrowser() : undefined;
    const { mounted, node, saves } = mountAsyncCounter();
    const execute = tools === undefined ? required(window.hyperteaAgent).executeTool.bind(undefined, "save") : required(tools.get("save")).execute;
    const first = execute({ amount: 4 }, { signal: new AbortController().signal });
    const second = execute({ amount: 8 }, { signal: new AbortController().signal });
    let firstResolved = false;
    void first.then(() => { firstResolved = true; });
    await mounted.settle();
    expect(firstResolved).toBe(false);
    const secondSave = required(saves[1]);
    mounted.dispatch({ ...secondSave, type: "saved", status: "applied-with-refresh-failure" });
    expect(await second).toEqual({ status: "applied-with-refresh-failure", count: 8 });
    expect(node.textContent).toBe("8");
    expect(firstResolved).toBe(false);
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "rejected" });
    expect(await first).toEqual({ status: "rejected", count: 4 });
  });

  test("cancellation rejects without dispatching an already cancelled request", async () => {
    const tools = installBrowser();
    const { saves } = mountAsyncCounter();
    const abort = new AbortController();
    abort.abort();
    await expect(required(tools.get("save")).execute({ amount: 4 }, { signal: abort.signal }))
      .rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
    expect(saves).toEqual([]);
  });

  test.each(["abort", "disable", "stop"] as const)("%s reports unknown after dispatch and ignores late completion", async (action) => {
    const tools = installBrowser();
    const { mounted, saves, bridge } = mountAsyncCounter();
    const abort = new AbortController();
    const tool = required(tools.get("save"));
    const pending = tool.execute({ amount: 4 }, { signal: abort.signal });
    const rejected = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    switch (action) {
      case "abort": abort.abort(); break;
      case "disable": mounted.dispatch({ type: "enable", enabled: false }); break;
      case "stop": mounted.stop(); break;
    }
    await rejected;
    const save = required(saves[0]);
    mounted.dispatch({ ...save, type: "saved", status: "applied" });
    await bridge.complete({ type: "webmcp.complete", invocation: save.invocation, result: { status: "late" } });
    // Cancellation only stops the caller waiting. Application work can still apply.
    expect(mounted.model().count).toBe(action === "stop" ? 0 : 4);
    if (action !== "abort") {
      expect(tools.size).toBe(0);
      await expect(tool.execute({ amount: 2 }, { signal: new AbortController().signal }))
        .rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
      expect(saves).toHaveLength(1);
    }
  });

  test("stopping while a completion waits for rendering rejects the caller", async () => {
    const tools = installBrowser();
    const { mounted, saves } = mountAsyncCounter();
    const pending = required(tools.get("save")).execute({ amount: 4 }, { signal: new AbortController().signal });
    const rejected = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "applied" });
    mounted.stop();
    await rejected;
  });

  test.each(["throw", "reject"] as const)("registration %s removes the tool and reports a typed application message", async (failure) => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const tools = installBrowser(() => {
      if (failure === "throw") throw new Error("Registration failed");
      return Promise.reject(new Error("Registration failed"));
    });
    const { mounted } = mountAsyncCounter();
    await vi.runAllTimersAsync();
    expect(mounted.model().error).toBe("Error: Registration failed");
    expect(tools.size).toBe(0);
  });

  test("a registration rejection after removal cannot affect a replacement", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const registration = Promise.withResolvers<undefined>();
    let registrations = 0;
    const tools = installBrowser(() => registrations++ === 0 ? registration.promise : Promise.resolve());
    const { mounted } = mountAsyncCounter();
    mounted.dispatch({ type: "enable", enabled: false });
    mounted.dispatch({ type: "enable", enabled: true });
    registration.reject(new Error("Old registration"));
    await vi.runAllTimersAsync();
    expect(mounted.model().error).toBe("");
    expect(tools.size).toBe(1);
  });

  test("browsers without WebMCP retain ordinary program behavior and expose the fallback", async () => {
    const { mounted, node } = mountAsyncCounter();
    expect(window.hyperteaAgent?.getTools().map((tool) => tool.name)).toEqual(["save"]);
    mounted.dispatch({ type: "enable", enabled: false });
    await mounted.settle();
    expect(node.textContent).toBe("0");
    expect(mounted.model().error).toBe("");
  });

  test.each(["native", "fallback"] as const)("%s validation and application errors reject instead of leaving a pending call", async (transport) => {
    const tools = transport === "native" ? installBrowser() : undefined;
    const { mounted, saves } = mountAsyncCounter();
    const execute = tools === undefined ? required(window.hyperteaAgent).executeTool.bind(undefined, "save") : required(tools.get("save")).execute;
    const signal = new AbortController().signal;
    await expect(execute({ amount: "bad" }, { signal })).rejects.toThrow("Expected a finite amount");
    await expect(execute({ amount: -1 }, { signal })).rejects.toThrow("Application failure");
    await expect(execute({ amount: 13 }, { signal })).rejects.toThrow("WebMCP dispatch failed");
    expect(saves).toEqual([]);
    expect(mounted.model().count).toBe(0);
  });

  test("fallback discovery follows replacement and captured agents cannot execute after removal", async () => {
    const { mounted, saves } = mountAsyncCounter();
    const old = required(window.hyperteaAgent);
    const pending = old.executeTool("save", { amount: 2 });
    const rejected = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    mounted.dispatch({ type: "replaceTools" });
    await rejected;
    expect(old.getTools()).toEqual([]);
    await expect(old.executeTool("save", { amount: 1 })).rejects.toThrow("Unknown Hypertea tool");
    const current = required(window.hyperteaAgent);
    expect(current.getTools().map((tool) => tool.name)).toEqual(["save_alternate"]);
    expect(document.getElementById("hypertea-agent-tools")?.textContent).toContain('"name":"save_alternate"');
    const result = current.executeTool("save_alternate", { amount: 7 });
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "applied" });
    mounted.dispatch({ ...required(saves[1]), type: "saved", status: "applied" });
    expect(await result).toEqual({ status: "applied", count: 7 });
    mounted.stop();
    expect(current.getTools()).toEqual([]);
  });

  test("replacing tools cancels old calls and rejects old callbacks", async () => {
    const tools = installBrowser();
    const { mounted, saves } = mountAsyncCounter();
    const old = required(tools.get("save"));
    const signal = new AbortController().signal;
    const pending = old.execute({ amount: 2 }, { signal });
    const rejected = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    mounted.dispatch({ type: "replaceTools" });
    await rejected;
    expect([...tools.keys()]).toEqual(["save_alternate"]);
    await expect(old.execute({ amount: 1 }, { signal })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
    const current = required(tools.get("save_alternate")).execute({ amount: 7 }, { signal });
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "applied" });
    mounted.dispatch({ ...required(saves[1]), type: "saved", status: "applied" });
    expect(await current).toEqual({ status: "applied", count: 7 });
  });

  test("the first completion wins while rendering is pending", async () => {
    const tools = installBrowser();
    const { mounted, saves, bridge } = mountAsyncCounter();
    const pending = required(tools.get("save")).execute({ amount: 2 }, { signal: new AbortController().signal });
    const save = required(saves[0]);
    mounted.dispatch({ ...save, type: "saved", status: "applied" });
    await bridge.complete({ type: "webmcp.complete", invocation: save.invocation, result: { status: "duplicate" } });
    expect(await pending).toEqual({ status: "applied", count: 2 });
  });

  test("a bridge cannot be shared by simultaneous program subscriptions", () => {
    installBrowser();
    const { bridge } = mountAsyncCounter();
    expect(() => bridge.subscription([]).subscribe(() => undefined, { settle: () => Promise.resolve() }))
      .toThrow("Create one WebMCP bridge per mounted program");
  });

  test("subscriptions are safe when there is no document", () => {
    vi.stubGlobal("document", undefined);
    const bridge = createWebMCP({ onRegistrationError: () => ({ type: "error" }) });
    const stop = bridge.subscription([]).subscribe(() => undefined, { settle: () => Promise.resolve() });
    stop();
  });

  test("Chrome 152 tool callbacks can omit execution options", async () => {
    const tools = installBrowser();
    const { mounted, saves } = mountAsyncCounter();
    // The native browser does not supply the draft's second callback argument.
    const pending = required(tools.get("save")).execute({ amount: 3 });
    mounted.dispatch({ ...required(saves[0]), type: "saved", status: "applied" });
    expect(await pending).toEqual({ status: "applied", count: 3 });
  });

  test("a partial registration failure removes only this bridge's tools", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const tools = installBrowser();
    const first = mountAsyncCounter();
    const original = required(tools.get("save"));
    // An unrelated integration owns this native name outside Hypertea.
    tools.set("occupied", { ...original, name: "occupied" });
    type Msg = Readonly<{ type: "registrationFailed"; error: string; }>;
    const bridge = createWebMCP<Msg>({
      onRegistrationError: (error) => ({ type: "registrationFailed", error: String(error) }),
    });
    const declarations = ["other", "occupied"].map((name) => defineWebMCPTool({
      name, description: "Registration test", inputSchema: { type: "object" },
      parseInput: (input: unknown) => input,
      toMessage: (): Msg => ({ type: "registrationFailed", error: "Unused" }),
    }));
    const program = defineProgram<undefined, string, Msg, never>({
      init: () => ["", []],
      update: (_model, message) => [message.error, []],
      view: (error) => h("p", {}, error),
      subscriptions: () => [bridge.subscription(declarations)],
    });
    const node = document.createElement("p");
    document.body.append(node);
    const mounted = mountProgram({ node, flags: undefined, program });
    stops.push(mounted.stop);
    await vi.runAllTimersAsync();
    expect(mounted.model()).toBe("Error: Duplicate tool");
    expect([...tools.keys()]).toEqual(["save", "occupied"]);
    expect(window.hyperteaAgent?.getTools().map((tool) => tool.name)).toEqual(["save"]);
    expect(tools.get("save")).toBe(original);
    expect(first.mounted.model().error).toBe("");
  });
});


test("allowlisted messages validate before dispatch and complete through the mounted program", async () => {
  type Msg = { type: "add"; amount: number; invocation?: WebMCPInvocation } | { type: "failed" };
  const mcpTools = exposeMessages<Msg>([{ message: "add", description: "Add a number" }], {
    add: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"], additionalProperties: false },
  });
  const bridge = createWebMCP<Msg>({ onRegistrationError: () => ({ type: "failed" }) });
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProgram({
    node, flags: undefined,
    program: defineProgram<undefined, number, Msg, WebMCPCompletion>({
      init: () => [0, []],
      update: (count, msg) => msg.type === "failed" ? [count, []] : [count + msg.amount,
      msg.invocation === undefined ? [] : [{ type: "webmcp.complete", invocation: msg.invocation, result: count + msg.amount }]],
      view: (count) => h("output", {}, String(count)),
      subscriptions: () => [bridge.subscription(mcpTools)],
    }),
    runEffect: (_dispatch, effect) => bridge.complete(effect),
  });
  stops.push(mounted.stop);
  mounted.dispatch({ type: "add", amount: 2 });
  const agent = required(window.hyperteaAgent);
  expect(await agent.executeTool("add", { amount: 3 })).toBe(5);
  expect(node.textContent).toBe("5");
  for (const input of [{ amount: "3" }, { amount: Infinity }, {}, { amount: 3, invocation: "forged" }, { amount: 3, type: "failed" }]) {
    await expect(agent.executeTool("add", input)).rejects.toThrow(/Invalid input/);
  }
  expect(mounted.model()).toBe(5);
});
