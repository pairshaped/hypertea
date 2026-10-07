import { afterEach, describe, expect, test, vi } from "vitest";

import { clicked, defineProgram, effectOrigin, h, mountProgram, reply } from "./program.js";
import {
  createWebMCP,
  createWebMCPCaller,
  defineWebMCPTool,
  exposeMessages,
  observeWebMCPCalls,
  type WebMCPRegisteredTool,
} from "./webmcp.js";

const stops: Array<() => void> = [];

test("tool origin follows asynchronous effects without marking intervening human actions", async () => {
  const native = installBrowser();
  type Msg = Readonly<{ type: "begin" | "continued" }>;
  const bridge = createWebMCP<Msg>({ onRegistrationError: () => ({ type: "begin" }) });
  const tools = [defineWebMCPTool({ name: "origin", description: "Check origin", inputSchema: { type: "object" },
    parseInput: () => undefined, toMessage: (): Msg => ({ type: "begin" }) })];
  const observed: Array<string | undefined> = [];
  const resume: Array<() => void> = [];
  const node = document.createElement("output");
  document.body.append(node);
  const program = defineProgram<undefined, number, Msg, Msg>({
    init: () => [0, []], update: (model, message) => [model + 1,
      message.type === "continued" ? [reply("done"), message] : [message]],
    view: model => h("output", {}, model), subscriptions: () => [bridge.subscription(tools)],
  });
  const mounted = mountProgram({ node, flags: undefined, program, runEffect: async (dispatch, effect) => {
    observed.push(effectOrigin(dispatch));
    if (effect.type === "begin") {
      await new Promise<void>(resolve => { resume.push(resolve); });
      dispatch({ type: "continued" });
    }
  } });
  stops.push(mounted.stop);
  await mounted.settle();
  const caller = createWebMCPCaller(document); stops.push(caller.stop);
  for (const origin of ["native", "fallback", "builtin"] as const) {
    const pending = origin === "native" ? required(native.get("origin")).execute({})
      : origin === "fallback" ? required(window.hyperteaAgent).executeTool("origin", {}) : caller.capture().executeTool("origin", {});
    const attributed = origin === "builtin" ? "fallback" : origin;
    mounted.dispatch({ type: "begin" });
    expect(observed.splice(0)).toEqual([attributed, undefined]);
    for (const finish of resume.splice(0)) finish();
    await expect(pending).resolves.toBe("done");
    await mounted.settle();
    expect(observed.splice(0)).toEqual([attributed, undefined]);
  }
});

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
    | Readonly<{ type: "save"; amount: number; }>
    | Readonly<{ type: "saved"; amount: number; status: string; }>
    | Readonly<{ type: "registrationFailed"; error: unknown; }>
    | Readonly<{ type: "replaceTools"; }>
    | Readonly<{ type: "enable"; enabled: boolean; }>;
  type Save = Readonly<{ type: "save"; amount: number; }>;
  type Model = Readonly<{ count: number; enabled: boolean; alternate: boolean; error: string; }>;
  const saves: Array<{ effect: Save; dispatch: (message: Msg) => void }> = [];
  const bridge = createWebMCP<Msg>({ onRegistrationError: (error) => ({ type: "registrationFailed", error }) });
  const declarations = names.map((name) => defineWebMCPTool({
    name,
    description: "Save a counter value",
    inputSchema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
    parseInput: parseAmount,
    toMessage: (amount): Msg => ({ type: "save", amount }),
  }));
  const alternate = declarations.map((tool) => ({ ...tool, name: `${tool.name}_alternate` }));
  const program = defineProgram<undefined, Model, Msg, Save>({
    init: () => [{ count: 0, enabled: true, alternate: false, error: "" }, []],
    update: (model, message) => {
      switch (message.type) {
        case "save": {
          if (message.amount < 0) throw new Error("Application failure");
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- Model an untyped application throwing a non-Error value.
          if (message.amount === 13) throw "Application failure";
          return [model, [message]];
        }
        case "saved": return [{ ...model, count: message.amount }, [reply({ status: message.status, count: message.amount })]];
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
    node, flags: undefined, program, runEffect: (dispatch, effect) => new Promise<void>(resolve => {
      saves.push({ effect, dispatch: message => { dispatch(message); resolve(); } });
    }),
  });
  stops.push(mounted.stop);
  return { mounted, node, saves, bridge };
}

describe("WebMCP program integration", () => {
  test("native and fallback admission refuses before dispatch or start, and cleanup restores calls", async () => {
    const native = installBrowser();
    const { saves } = mountAsyncCounter();
    const start = vi.fn();
    const refusal = { reason: "assistant-busy", explanation: "Unfinished turn", nextStep: "Wait" };
    const stop = observeWebMCPCalls(document, { beforeDispatch: () => refusal, onStart: start });
    stops.push(stop);
    const agent = required(window.hyperteaAgent);
    expect(await agent.executeTool("save", { amount: 4 })).toEqual(refusal);
    expect(await required(native.get("save")).execute({ amount: 5 })).toEqual(refusal);
    expect(saves).toEqual([]);
    expect(start).not.toHaveBeenCalled();
    await expect(agent.executeTool("save", {})).rejects.toThrow("finite amount");
    stop();
    stops.push(observeWebMCPCalls(document, { beforeDispatch: () => undefined }));
    stops.push(observeWebMCPCalls(document, { onStart: start }));
    const pending = required(native.get("save")).execute({ amount: 7 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: "save" }), undefined);
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
    expect(await pending).toMatchObject({ count: 7 });
  });

  test("a start callback can cancel without dispatching, and observers belong only to their document", async () => {
    const { saves } = mountAsyncCounter();
    const signal = new AbortController();
    const elsewhere = document.implementation.createHTMLDocument();
    const foreign = vi.fn();
    stops.push(observeWebMCPCalls(elsewhere, { beforeDispatch: () => "foreign", onStart: foreign }));
    stops.push(observeWebMCPCalls(document, { onStart: () => { signal.abort(); } }));
    await expect(required(window.hyperteaAgent).executeTool("save", { amount: 1 }, { signal: signal.signal })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
    expect(saves).toEqual([]);
    expect(foreign).not.toHaveBeenCalled();
  });

  test("independent bundle copies share publication and admission, and keep each other's registrations", async () => {
    const first = mountAsyncCounter();
    const agent = required(window.hyperteaAgent);
    vi.resetModules();
    const copy = await import("./webmcp.js");
    const onStart = vi.fn();
    const refusal = { reason: "busy" };
    const stop = copy.observeWebMCPCalls(document, { beforeDispatch: () => refusal, onStart });
    stops.push(stop);
    expect(await agent.executeTool("save", { amount: 1 })).toEqual(refusal);
    const bridge = copy.createWebMCP<{ type: "release" }>({ onRegistrationError: () => { throw Error("Registration failed"); } });
    const tool = copy.defineWebMCPTool({ name: "release", description: "Release", inputSchema: {}, parseInput: () => undefined, toMessage: () => ({ type: "release" as const }) });
    const node = document.createElement("output"); document.body.append(node);
    const second = mountProgram({ node, flags: undefined, program: defineProgram<undefined, number, { type: "release" }, never>({
      init: () => [0, []], update: model => [model, [reply("released")]], view: model => h("output", {}, model),
      subscriptions: () => [bridge.subscription([tool])],
    }) });
    const unsubscribe = second.stop;
    stops.push(unsubscribe);
    expect(window.hyperteaAgent).toBe(agent);
    expect(agent.getTools().map((t) => t.name)).toEqual(["save", "release"]);
    stop();
    expect(await agent.executeTool("release", {})).toBe("released");
    unsubscribe();
    expect(agent.getTools().map((t) => t.name)).toEqual(["save"]);
    const pending = agent.executeTool("save", { amount: 3 });
    required(first.saves[0]).dispatch({ ...required(first.saves[0]).effect, type: "saved", status: "applied" });
    expect(await pending).toMatchObject({ count: 3 });
  });
  test("registering tools exposes a catalog and completes calls without native WebMCP", async () => {
    const { mounted, node, saves } = mountAsyncCounter();
    const agent = required(window.hyperteaAgent);
    const catalog = document.querySelector('script#hypertea-agent-tools[type="application/json"]');
    expect(JSON.parse(catalog?.textContent ?? "{}")).toMatchObject({
      version: 1, global: "hyperteaAgent", tools: [{ name: "save" }],
    });
    expect(agent.getTools().map((tool) => tool.name)).toEqual(["save"]);
    const pending = agent.executeTool("save", { amount: 4 });
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
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
    required(first.saves[0]).dispatch({ ...required(first.saves[0]).effect, type: "saved", status: "applied" });
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
    required(second.saves[0]).dispatch({ ...required(second.saves[0]).effect, type: "saved", status: "applied" });
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
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
    expect(mounted.model().count).toBe(action === "stop" ? 0 : 4);
    if (action !== "abort") expect(window.hyperteaAgent).toBeUndefined();
  });

  test("human and tool actions share an update and tools reply after rendering", async () => {
    const tools = installBrowser();
    type Msg =
      | Readonly<{ type: "add"; amount: number; }>
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
      toMessage: (amount): Msg => ({ type: "add", amount }),
    })];
    const program = defineProgram<undefined, number, Msg, never>({
      init: () => [0, []],
      update: (count, message) => {
        if (message.type === "registrationFailed") throw message.error;
        const next = count + message.amount;
        return [next, [reply({ status: "applied", count: next })]];
      },
      view: (count) => h("button", { onClick: clicked<Msg>({ type: "add", amount: 1 }) }, String(count)),
      subscriptions: () => [bridge.subscription(declarations)],
    });
    const node = document.createElement("button");
    document.body.append(node);
    const mounted = mountProgram({ node, flags: undefined, program });
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
    secondSave.dispatch({ ...secondSave.effect, type: "saved", status: "applied-with-refresh-failure" });
    expect(await second).toEqual({ status: "applied-with-refresh-failure", count: 8 });
    expect(node.textContent).toBe("8");
    expect(firstResolved).toBe(false);
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "rejected" });
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
    const { mounted, saves } = mountAsyncCounter();
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
    save.dispatch({ ...save.effect, type: "saved", status: "applied" });
    save.dispatch({ ...save.effect, type: "saved", status: "late" });
    // Cancellation only stops the caller waiting. Application work can still apply.
    expect(mounted.model().count).toBe(action === "stop" ? 0 : 4);
    if (action !== "abort") {
      expect(tools.size).toBe(0);
      await expect(tool.execute({ amount: 2 }, { signal: new AbortController().signal }))
        .rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
      expect(saves).toHaveLength(1);
    }
  });

  test("stopping after a reply cannot replace it with unknown", async () => {
    const tools = installBrowser();
    const { mounted, saves } = mountAsyncCounter();
    const pending = required(tools.get("save")).execute({ amount: 4 }, { signal: new AbortController().signal });
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
    mounted.stop();
    await expect(pending).resolves.toEqual({ status: "applied", count: 4 });
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
    await expect(execute({ amount: -1 }, { signal })).rejects.toMatchObject({ outcome: "unknown" });
    await expect(execute({ amount: 13 }, { signal })).rejects.toMatchObject({ outcome: "unknown" });
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
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
    required(saves[1]).dispatch({ ...required(saves[1]).effect, type: "saved", status: "applied" });
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
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
    required(saves[1]).dispatch({ ...required(saves[1]).effect, type: "saved", status: "applied" });
    expect(await current).toEqual({ status: "applied", count: 7 });
  });

  test("the first completion wins while rendering is pending", async () => {
    const tools = installBrowser();
    const { saves } = mountAsyncCounter();
    const pending = required(tools.get("save")).execute({ amount: 2 }, { signal: new AbortController().signal });
    const save = required(saves[0]);
    save.dispatch({ ...save.effect, type: "saved", status: "applied" });
    save.dispatch({ ...save.effect, type: "saved", status: "duplicate" });
    expect(await pending).toEqual({ status: "applied", count: 2 });
  });

  test("a bridge cannot be shared by simultaneous program subscriptions", () => {
    installBrowser();
    const { bridge } = mountAsyncCounter();
    expect(() => bridge.subscription([]).subscribe(() => undefined, { call: () => Promise.reject(new Error("Unexpected program call")) }))
      .toThrow("Create one WebMCP bridge per mounted program");
  });

  test("subscriptions are safe when there is no document", () => {
    vi.stubGlobal("document", undefined);
    const bridge = createWebMCP({ onRegistrationError: () => ({ type: "error" }) });
    const stop = bridge.subscription([]).subscribe(() => undefined, { call: () => Promise.reject(new Error("Unexpected program call")) });
    stop();
  });

  test("Chrome 152 tool callbacks can omit execution options", async () => {
    const tools = installBrowser();
    const { saves } = mountAsyncCounter();
    // The native browser does not supply the draft's second callback argument.
    const pending = required(tools.get("save")).execute({ amount: 3 });
    required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
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
  type Msg = { type: "add"; amount: number } | { type: "failed" };
  const mcpTools = exposeMessages<Msg>([{ message: "add", description: "Add a number" }], {
    add: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"], additionalProperties: false },
  });
  const bridge = createWebMCP<Msg>({ onRegistrationError: () => ({ type: "failed" }) });
  const node = document.createElement("output");
  document.body.append(node);
  const mounted = mountProgram({
    node, flags: undefined,
    program: defineProgram<undefined, number, Msg, never>({
      init: () => [0, []],
      update: (count, msg) => msg.type === "failed" ? [count, []] : [count + msg.amount,
      [reply(count + msg.amount)]],
      view: (count) => h("output", {}, String(count)),
      subscriptions: () => [bridge.subscription(mcpTools)],
    }),
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

test("registration failure rejects an already dispatched call", async () => {
  const registration = Promise.withResolvers<undefined>();
  installBrowser(() => registration.promise);
  const { saves, mounted } = mountAsyncCounter();
  const pending = required(window.hyperteaAgent).executeTool("save", { amount: 5 });
  const rejected = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
  registration.reject(new Error("Registration failed"));
  await rejected;
  required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
  expect(mounted.model().count).toBe(5);
});

test("adapter preserves a pre-dispatch rejection from its subscription call boundary", async () => {
  const bridge = createWebMCP<{ type: "read" }>({ onRegistrationError: () => { throw new Error("Unexpected registration failure"); } });
  const tools = [defineWebMCPTool({ name: "read", description: "Read", inputSchema: {}, parseInput: () => undefined, toMessage: () => ({ type: "read" as const }) })];
  const stop = bridge.subscription(tools).subscribe(() => undefined, {
    call: () => Promise.reject(Object.assign(new Error("cancelled"), { outcome: "cancelled-before-dispatch" })),
  });
  stops.push(stop);
  await expect(required(window.hyperteaAgent).executeTool("read", {})).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
});


function jsonTool() {
  const [tool] = exposeMessages<{type: "replace"; document: unknown}>([{message: "replace", description: "Replace a JSON document"}], {
    replace: {type: "object", properties: {document: {"x-hypertea-json-value": true}}, required: ["document"], additionalProperties: false},
  });
  if (tool === undefined) throw new Error("Missing JSON tool");
  return tool;
}

test("JSON field preserves finite values and shared subobjects in a detached copy", () => {
  const shared = {text: "club", values: [null, true, false, 1.5]};
  const document = Object.assign(Object.create(null) as Record<string, unknown>, {left: shared, right: shared, toJSON: "ordinary data"});
  const message = jsonTool().toMessage({document});
  expect(message.document).toEqual({left: shared, right: shared, toJSON: "ordinary data"});
  shared.text = "changed";
  expect(message.document).toMatchObject({left: {text: "club"}, right: {text: "club"}});
  expect(document.left).toBe(shared);
  expect(() => jsonTool().toMessage({document, extra: true})).toThrow(/Invalid input/);
  expect(() => jsonTool().toMessage({})).toThrow(/Invalid input/);
});

test.each([undefined, () => 1, Symbol("bad"), 1n, NaN, Infinity, -Infinity,
  {nested: undefined}, [undefined], new Array(1), new Date(), Object.assign([], {extra: true}),
  Object.defineProperty({}, "hidden", {value: "ignored", enumerable: false}),
  {[Symbol("hidden")]: 1}, {toJSON: () => ({safe: true})},
])("JSON field refuses non-JSON case %#", document => {
  expect(() => jsonTool().toMessage({document})).toThrow(/Invalid input/);
});

test("JSON field refuses cycles, getters, custom prototypes and throwing descriptor traps", () => {
  const cycle: {next?: unknown} = {}; cycle.next = cycle;
  const getter = vi.fn(() => "unsafe");
  const accessor = Object.defineProperty({}, "value", {enumerable: true, get: getter});
  const accessorArray = Object.defineProperty([1], "0", {enumerable: true, get: getter});
  const custom = Object.create({toJSON: getter}) as object;
  const throwing = new Proxy({}, {ownKeys: () => {throw new Error("trap");}});
  for (const document of [cycle, accessor, accessorArray, custom, throwing])
    expect(() => jsonTool().toMessage({document})).toThrow(/Invalid input/);
  expect(getter).not.toHaveBeenCalled();
});

test("JSON admission never invokes proxy reads or custom serialization", () => {
  const read = vi.fn(() => {throw new Error("read trap");});
  const document = new Proxy({safe: "descriptor data"}, {get: read});
  expect(jsonTool().toMessage({document})).toEqual({type: "replace", document: {safe: "descriptor data"}});
  expect(read).not.toHaveBeenCalled();
});

test("JSON admission rejects operation array accessors before schema traversal", () => {
  const [tool] = exposeMessages<{type: "replace"; operations: unknown}>([{message: "replace", description: "Replace"}], {
    replace: {type: "object", properties: {operations: {type: "array", items: {type: "object", properties: {document: {"x-hypertea-json-value": true}}, required: ["document"], additionalProperties: false}}}, required: ["operations"], additionalProperties: false},
  });
  if (tool === undefined) throw new Error("Missing tool");
  const getter = vi.fn(() => ({document: {}}));
  const operations = Object.defineProperty([{}], "0", {enumerable: true, get: getter});
  expect(() => tool.toMessage({operations})).toThrow(/Invalid input/);
  expect(getter).not.toHaveBeenCalled();
});


test.each([Object.prototype, Array.prototype])("JSON field rejects inherited serialization without executing it %#", prototype => {
  const serialize = vi.fn(() => ({altered: true}));
  Object.defineProperty(prototype, "toJSON", {configurable: true, get: serialize});
  try {
    expect(() => jsonTool().toMessage({document: []})).toThrow(/Invalid input/);
    expect(serialize).not.toHaveBeenCalled();
  } finally { Reflect.deleteProperty(prototype, "toJSON"); }
});


test("JSON admission refuses data that becomes non-JSON between validation and copy", () => {
  let reads = 0;
  const input = new Proxy({document: {}}, {getOwnPropertyDescriptor(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return key === "document" ? {...descriptor, value: ++reads <= 3 ? {} : undefined} : descriptor;
  }});
  expect(() => jsonTool().toMessage(input)).toThrow(/Invalid input/);
  expect(reads).toBe(4);
});

test("JSON admission rechecks closed discriminants after copying", () => {
  const [tool] = exposeMessages<{type: "replace"; mode: "review"; document: unknown}>([{message: "replace", description: "Replace"}], {
    replace: {type: "object", properties: {mode: {const: "review"}, document: {"x-hypertea-json-value": true}}, required: ["mode", "document"], additionalProperties: false},
  });
  if (tool === undefined) throw new Error("Missing tool");
  let reads = 0;
  const input = new Proxy({mode: "review", document: {}}, {getOwnPropertyDescriptor(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return key === "mode" ? {...descriptor, value: ++reads <= 3 ? "review" : "publish"} : descriptor;
  }});
  expect(() => tool.toMessage(input)).toThrow(/Invalid input/);
  expect(reads).toBe(4);
});

test("scoped callers identify only their own invocation without changing tool origin or bypassing admission", async () => {
  const native = installBrowser();
  const { saves } = mountAsyncCounter();
  const caller = createWebMCPCaller(document); stops.push(caller.stop);
  const other = createWebMCPCaller(document); stops.push(other.stop);
  const agent = caller.capture(), started = vi.fn();
  stops.push(observeWebMCPCalls(document, {
    beforeDispatch: (_tool, handle) => handle === caller.handle ? undefined : { reason: "busy" }, onStart: started,
  }));
  expect(agent.getTools().map(t => t.name)).toEqual(["save"]);
  expect(await required(window.hyperteaAgent).executeTool("save", { amount: 1 })).toEqual({ reason: "busy" });
  expect(await required(native.get("save")).execute({ amount: 1 })).toEqual({ reason: "busy" });
  expect(await other.capture().executeTool("save", { amount: 1 })).toEqual({ reason: "busy" });
  const pending = agent.executeTool("save", { amount: 2 });
  expect(started).toHaveBeenCalledWith(expect.objectContaining({ name: "save" }), caller.handle);
  expect(required(saves[0]).effect).toMatchObject({ amount: 2 });
  required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
  expect(await pending).toMatchObject({ count: 2 });
  stops.push(observeWebMCPCalls(document, { beforeDispatch: () => "domain-refusal" }));
  expect(await agent.executeTool("save", { amount: 9 })).toBe("domain-refusal");
  expect(saves).toHaveLength(1);
});

test("captured caller catalog refuses missing, replaced and detached tools before dispatch", async () => {
  const caller = createWebMCPCaller(document); stops.push(caller.stop);
  const empty = caller.capture(); expect(empty.getTools()).toEqual([]);
  await expect(empty.executeTool("missing", {})).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  const first = mountAsyncCounter();
  const captured = caller.capture();
  await expect(captured.executeTool("missing", {})).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  first.mounted.stop();
  const second = mountAsyncCounter();
  await expect(captured.executeTool("save", { amount: 1 })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  expect(second.saves).toHaveLength(0);
  const fresh = caller.capture(); second.mounted.dispatch({ type: "replaceTools" });
  await expect(fresh.executeTool("save", { amount: 1 })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  const beforeAddition = caller.capture();
  const added = mountAsyncCounter(["another"]);
  await expect(beforeAddition.executeTool("save_alternate", { amount: 1 })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  expect(second.saves).toHaveLength(0);
  const beforeReplacement = caller.capture();
  added.mounted.dispatch({ type: "replaceTools" });
  await expect(beforeReplacement.executeTool("save_alternate", { amount: 1 })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
});

test("caller lifetime and per-call signals distinguish cancellation before dispatch from unknown after dispatch", async () => {
  const { saves } = mountAsyncCounter();
  const caller = createWebMCPCaller(document); stops.push(caller.stop);
  const agent = caller.capture(), signal = new AbortController(); signal.abort();
  await expect(agent.executeTool("save", { amount: 1 }, { signal: signal.signal })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  const live = new AbortController();
  const pending = agent.executeTool("save", { amount: 2 }, { signal: live.signal });
  const outcome = expect(pending).rejects.toMatchObject({ outcome: "unknown" });
  caller.stop(); await outcome;
  await expect(agent.executeTool("save", { amount: 3 })).rejects.toMatchObject({ outcome: "cancelled-before-dispatch" });
  expect(saves).toHaveLength(1);
  required(saves[0]).dispatch({ ...required(saves[0]).effect, type: "saved", status: "applied" });
});
