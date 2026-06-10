import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  app,
  assertNever,
  changed,
  checkedChanged,
  clicked,
  dragEnded,
  dragEntered,
  dragStarted,
  every,
  fragment,
  h,
  inputChanged,
  keyPressed,
  memo,
  noEffect,
  start,
  submitted,
  text,
  typedH,
  windowResized,
  type Action,
  type Effecter,
  type Indexable,
  type Key,
  type MemoView,
  type Runtime,
  type Subscriber,
  type TypedH,
  type VNode,
} from "./index.js";

type CounterState = {
  readonly count: number;
  readonly label: string;
  readonly keyed: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly styleColor?: string;
  readonly customValue?: unknown;
};

type RuntimeNode = Node & {
  events?: Readonly<Record<string, unknown>>;
};

const initialState: CounterState = {
  count: 0,
  label: "start",
  keyed: ["a", "b"],
  enabled: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VNode helpers", () => {
  test("creates text nodes from arbitrary values", () => {
    expect(text(42)).toMatchObject({
      tag: "42",
      props: {},
      key: undefined,
      children: [],
      type: 3,
      node: undefined,
    });
  });

  test("creates element nodes with normalized class names and children", () => {
    const child = text("save");
    const vnode = h<CounterState>(
      "button",
      {
        key: "primary",
        class: [
          "button",
          false,
          null,
          undefined,
          ["hot", { selected: true, active: true, disabled: false, hidden: null }],
        ],
        type: "button",
      },
      child,
      [" now"],
    );

    expect(vnode).toMatchObject({
      tag: "button",
      key: "primary",
      props: {
        class: "button hot selected active",
        type: "button",
      },
      children: [child, { tag: " now" }],
      type: 1,
    });
    expect(vnode.props).not.toHaveProperty("key");
  });

  test("supports undefined props, nested fragments, and primitive children", () => {
    const children = fragment(undefined, "Hello ", [text("there"), false, 2]);
    const vnode = h("p", undefined, children, null, true, undefined);

    expect(vnode.props).toEqual({});
    expect(vnode.children.map((child) => (child as VNode).tag)).toEqual([
      "Hello ",
      "there",
      "2",
    ]);
  });

  test("supports omitted children and class objects with no active values", () => {
    const vnode = h<CounterState>("div", {
      class: { hidden: false, missing: null },
    });

    expect(vnode.props).not.toHaveProperty("class");
    expect(vnode.children).toEqual([]);
  });

  test("creates memoized view placeholders", () => {
    const view: MemoView<CounterState, Readonly<{ label: string }>> = (data) =>
      h<CounterState>("span", {}, text(data.label));
    const data: Indexable = { label: "cached" };
    const vnode = memo(view, { label: "cached" });
    const key: Key = "cache-key";

    expect(vnode.tag).toBe(view);
    expect(vnode.memo).toEqual(data);
    expect(key).toBe("cache-key");
    expect(vnode.type).toBe(1);
  });

  test("creates state-aware h helpers", () => {
    const hh: TypedH<CounterState> = typedH();
    const increment: Action<CounterState> = (state) => ({
      ...state,
      count: state.count + 1,
    });

    const vnode = hh("button", { onclick: increment }, text("Increment"));

    expect(vnode.props.onclick).toBe(increment);
    expect(vnode.children[0]).toMatchObject({ tag: "Increment" });
  });

  test("creates an empty effect marker", () => {
    expect(noEffect()).toBe(false);
  });

  test("throws with the unhandled value in the message", () => {
    expect(() => assertNever("missing" as never)).toThrow(
      'Unhandled message: "missing"',
    );
  });
});

describe("TEA island runtime", () => {
  type IslandModel = Readonly<{
    enabled: boolean;
    text: string;
    ticks: number;
  }>;

  type IslandMsg =
    | Readonly<{ type: "clicked" }>
    | Readonly<{ type: "changed"; value: string }>
    | Readonly<{ type: "checked"; value: boolean }>
    | Readonly<{ type: "submitted" }>
    | Readonly<{ type: "tick" }>;

  type IslandEffect = Readonly<{ type: "boot" }>;

  test("starts with effects and dispatches event helper messages", async () => {
    const mount = appendMount("<form></form>");
    const effects: Array<string> = [];
    const runtime: Runtime<IslandModel, IslandMsg, IslandEffect> = {
      node: mount,
      init: () => [
        { enabled: false, text: "", ticks: 0 },
        [{ type: "boot" }],
      ],
      update: (model, message) => {
        switch (message.type) {
          case "clicked":
            return [{ ...model, text: "clicked" }, []];
          case "changed":
            return [{ ...model, text: message.value }, []];
          case "checked":
            return [{ ...model, enabled: message.value }, []];
          case "submitted":
            return [{ ...model, text: "submitted" }, []];
          case "tick":
            return [{ ...model, ticks: model.ticks + 1 }, []];
        }
      },
      view: (model) =>
        h("form", { onSubmit: submitted({ type: "submitted" }) }, [
          h("button", { onClick: clicked({ type: "clicked" }), type: "button" }, [
            model.text,
          ]),
          h("input", {
            checked: model.enabled,
            onChange: checkedChanged((value) => ({ type: "checked", value })),
            type: "checkbox",
          }),
          h("textarea", {
            onInput: inputChanged((value) => ({ type: "changed", value })),
            value: model.text,
          }),
          h("span", {}, String(model.ticks)),
        ]),
      runEffect: (dispatch, effect) => {
        effects.push(effect.type);
        dispatch({ type: "tick" });
      },
    };

    start(runtime);
    await flushRender();

    const button = requireElement("button");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushRender();

    expect(button.textContent).toBe("clicked");

    const checkbox = requireElement("input") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flushRender();

    expect(checkbox.checked).toBe(true);

    const textarea = requireElement("textarea") as HTMLTextAreaElement;
    textarea.value = "typed";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await flushRender();

    expect(textarea.value).toBe("typed");

    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    requireElement("form").dispatchEvent(submitEvent);
    await flushRender();

    expect(submitEvent.defaultPrevented).toBe(true);
    expect(requireElement("button").textContent).toBe("submitted");
    expect(requireElement("span").textContent).toBe("1");
    expect(effects).toEqual(["boot"]);
  });

  test("throws when event helpers are rendered outside start", () => {
    expect(() => h("button", { onClick: clicked({ type: "clicked" }) })).toThrow(
      "Event helpers can only be used while rendering a view",
    );
  });

  test("reads input helper values from form controls and fallbacks", () => {
    const input = globalThis.document.createElement("input");
    input.value = "input";
    const select = globalThis.document.createElement("select");
    const option = globalThis.document.createElement("option");
    option.value = "select";
    select.append(option);
    select.value = "select";
    const textarea = globalThis.document.createElement("textarea");
    textarea.value = "textarea";
    const checkbox = globalThis.document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;

    const read = inputChanged((value) => value);
    const checked = checkedChanged((value) => value);

    expect(read.toMsg(eventFor(input, "input"))).toBe("input");
    expect(read.toMsg(eventFor(select, "change"))).toBe("select");
    expect(read.toMsg(eventFor(textarea, "input"))).toBe("textarea");
    expect(read.toMsg(new Event("input"))).toBe("");
    expect(checked.toMsg(eventFor(checkbox, "change"))).toBe(true);
    expect(checked.toMsg(new Event("change"))).toBe(false);
  });

  test("creates simple message event bindings", () => {
    expect(changed("change").toMsg(new Event("change"))).toBe("change");
    expect(clicked("click").toMsg(new Event("click"))).toBe("click");
    expect(dragStarted("start").toMsg(new Event("dragstart"))).toBe("start");
    expect(dragEntered("enter").toMsg(new Event("dragenter"))).toBe("enter");
    expect(dragEnded("end").toMsg(new Event("dragend"))).toBe("end");
  });

  test("provides generic browser subscriptions", async () => {
    const messages: Array<unknown> = [];

    const stopEvery = every(10, () => "tick").subscribe((message) => {
      messages.push(message);
    });
    await vi.advanceTimersByTimeAsync(10);
    stopEvery();
    await vi.advanceTimersByTimeAsync(10);

    const stopKeys = keyPressed((key) => ({ key })).subscribe((message) => {
      messages.push(message);
    });
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    stopKeys();

    const stopResize = windowResized((viewport) => viewport).subscribe(
      (message) => {
        messages.push(message);
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    stopResize();

    expect(messages).toEqual([
      "tick",
      { key: "Enter" },
      { width: globalThis.innerWidth, height: globalThis.innerHeight },
    ]);
  });

  test("starts runtime subscriptions that dispatch messages", async () => {
    const mount = appendMount("<span></span>");
    let dispatchTick: ((message: IslandMsg) => void) | undefined;
    const subscription = {
      key: "external",
      subscribe: (dispatch: (message: IslandMsg) => void) => {
        dispatchTick = dispatch;
        return () => undefined;
      },
    };

    start<IslandModel, IslandMsg, never>({
      node: mount,
      init: () => [{ enabled: false, text: "", ticks: 0 }, []],
      update: (model, message) => {
        switch (message.type) {
          case "tick":
            return [{ ...model, ticks: model.ticks + 1 }, []];
          case "clicked":
          case "changed":
          case "checked":
          case "submitted":
            return [model, []];
        }
      },
      view: (model) => h("span", {}, String(model.ticks)),
      runEffect: () => undefined,
      subscriptions: () => [subscription],
    });

    await flushRender();
    dispatchTick?.({ type: "tick" });
    await flushRender();

    expect(requireElement("span").textContent).toBe("1");
  });
});

describe("app", () => {
  test("renders state, patches text and properties, and dispatches event actions", async () => {
    const mount = appendMount("<main id=\"app\">server</main>");
    const increment: Action<CounterState, Event> = (state) => ({
      ...state,
      count: state.count + 1,
      label: "clicked",
      styleColor: "red",
    });

    app<CounterState>({
      init: initialState,
      view: (state) =>
        h<CounterState>("main", { id: "app" }, [
          h<CounterState>(
            "button",
            {
              onclick: increment,
              type: "button",
              value: state.label,
              style: {
                color: state.styleColor,
                "--accent": state.styleColor,
              },
            },
            text(`${state.label}:${String(state.count)}`),
          ),
          state.enabled ? h<CounterState>("p", {}, text("enabled")) : false,
        ]),
      node: mount,
    });

    await flushRender();

    const button = requireElement("button") as HTMLButtonElement;
    expect(button.textContent).toBe("start:0");
    expect(button.value).toBe("start");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushRender();

    expect(button.textContent).toBe("clicked:1");
    expect(button.value).toBe("clicked");
    expect(button.style.color).toBe("red");
    expect(button.style.getPropertyValue("--accent")).toBe("red");
  });

  test("runs action payloads, state tuples, and effect tuples", async () => {
    const mount = appendMount("<section></section>");
    const seen: Array<string> = [];
    const directEffect: Effecter<CounterState> = (dispatch) => {
      seen.push("direct");
      dispatch({ ...initialState, count: 3, label: "direct" });
    };
    const payloadEffect: Effecter<CounterState, string> = (dispatch, payload) => {
      seen.push(payload);
      dispatch({ ...initialState, count: 4, label: payload });
    };
    const setLabel: Action<CounterState, string> = (state, label) => [
      { ...state, count: 2, label },
      false,
      true,
      null,
      undefined,
      "",
      0,
      directEffect,
      [payloadEffect, "payload"],
    ];

    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) =>
        h<CounterState>(
          "section",
          {},
          text(`${state.label}:${String(state.count)}`),
        ),
      node: mount,
    });

    await flushRender();

    dispatch([setLabel, "action"]);
    await flushRender();

    expect(seen).toEqual(["direct", "payload"]);
    expect(requireElement("section").textContent).toBe("payload:4");
  });

  test("runs the first effect in a state tuple", async () => {
    const mount = appendMount("<section></section>");
    const seen: Array<string> = [];
    const directEffect: Effecter<CounterState> = (dispatch) => {
      seen.push("direct");
      dispatch({ ...initialState, count: 5, label: "effect" });
    };

    app<CounterState>({
      init: [{ ...initialState, label: "init" }, directEffect],
      view: (state) =>
        h<CounterState>(
          "section",
          {},
          text(`${state.label}:${String(state.count)}`),
        ),
      node: mount,
    });

    await flushRender();

    expect(seen).toEqual(["direct"]);
    expect(requireElement("section").textContent).toBe("effect:5");
  });

  test("supports custom dispatch wrappers", () => {
    const wrapped: Array<string> = [];

    const dispatch = app<CounterState>({
      init: initialState,
      dispatch: (next) => (dispatchable, payload) => {
        wrapped.push(typeof dispatchable);
        next(dispatchable, payload);
      },
    });

    dispatch({ ...initialState, label: "manual" });

    expect(wrapped).toEqual(["object", "object"]);
  });

  test("starts, preserves, restarts, and stops subscriptions", () => {
    const starts: Array<string> = [];
    const stops: Array<string> = [];
    const subscriber: Subscriber<
      CounterState,
      {
        id: number;
        action: readonly [Action<CounterState>, string];
        callback: Action<CounterState>;
      }
    > = (_dispatch, payload) => {
        starts.push(String(payload.id));
        return () => {
          stops.push(String(payload.id));
        };
      };
    const unchangedCallback: Action<CounterState> = (state) => state;
    const dispatch = app<CounterState>({
      init: initialState,
      subscriptions: (state) =>
        state.enabled
          ? [
              [
                subscriber,
                {
                  id: state.count,
                  action: [unchangedCallback, "same"],
                  callback: unchangedCallback,
                },
              ],
            ]
          : [false],
    });

    dispatch({ ...initialState, count: 0 });
    dispatch({ ...initialState, count: 0 });
    dispatch({ ...initialState, count: 1 });
    dispatch({ ...initialState, count: 1, enabled: false });
    dispatch(null as unknown as CounterState);
    dispatch({ ...initialState, count: 2 });

    expect(starts).toEqual(["0", "1"]);
    expect(stops).toEqual(["0", "1"]);
  });

  test("does not restart primitive subscriptions when payloads are unchanged", () => {
    const starts: Array<number> = [];
    const subscriber: Subscriber<CounterState, number> = (_dispatch, payload) => {
      starts.push(payload);
      return () => {
        return undefined;
      };
    };
    const dispatch = app<CounterState>({
      init: initialState,
      subscriptions: (state) => [[subscriber, state.count]],
    });

    dispatch({ ...initialState, count: 0, label: "same payload" });

    expect(starts).toEqual([0]);
  });

  test("restarts subscriptions when payload keys are removed", () => {
    const starts: Array<string> = [];
    const stops: Array<string> = [];
    const subscriber: Subscriber<
      CounterState,
      { id: string; removed?: string }
    > = (_dispatch, payload) => {
      starts.push(payload.id);
      return () => {
        stops.push(payload.id);
      };
    };
    const dispatch = app<CounterState>({
      init: initialState,
      subscriptions: (state) => [
        [
          subscriber,
          {
            id: "same",
            ...(state.enabled ? { removed: "present" } : {}),
          },
        ],
      ],
    });

    dispatch({ ...initialState, enabled: false });

    expect(starts).toEqual(["same", "same"]);
    expect(stops).toEqual(["same"]);
  });

  test("falls back to setTimeout when animation frames are unavailable", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const mount = appendMount("<div></div>");

    app<CounterState>({
      init: initialState,
      view: (state) => h<CounterState>("div", {}, text(state.label)),
      node: mount,
    });

    await flushRender();

    expect(requireElement("div").textContent).toBe("start");
  });

  test("renders keyed, unkeyed, svg, nullable children, and attributes", async () => {
    const mount = appendMount("<div><span>old</span></div>");
    const dispatch = app<CounterState>({
      init: {
        ...initialState,
        keyed: ["a", "b"],
        customValue: { ignored: true },
      },
      view: renderMixedView,
      node: mount,
    });

    await flushRender();

    expect(globalThis.document.body.innerHTML).toContain(
      "<li data-id=\"a\">a</li><li data-id=\"b\">b</li>",
    );
    expect(requireElement("input").getAttribute("list")).toBe("choices");
    expect(requireElement("input").getAttribute("data-object")).toBe("");
    expect(requireElement("circle").namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );

    const firstNode = requireElement("li");

    dispatch({
      ...initialState,
      keyed: ["b", "c"],
      enabled: false,
      customValue: false,
    });
    await flushRender();

    const items = Array.from(globalThis.document.querySelectorAll("li"));
    expect(items.map((item) => item.textContent)).toEqual(["b", "c"]);
    expect(items[0]).not.toBe(firstNode);
    expect(requireElement("input").hasAttribute("data-object")).toBe(false);
    expect(globalThis.document.body.textContent).not.toContain("nullable");
  });

  test("replaces nodes when tags change", async () => {
    const mount = appendMount("<div></div>");
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) =>
        state.enabled
          ? h<CounterState>("div", { id: "swap" }, text("div"))
          : h<CounterState>("article", { id: "swap" }, text("article")),
      node: mount,
    });

    await flushRender();
    expect(requireElement("#swap").tagName).toBe("DIV");

    dispatch({ ...initialState, enabled: false });
    await flushRender();

    expect(requireElement("#swap").tagName).toBe("ARTICLE");
  });

  test("removes event listeners when event props are removed", async () => {
    const mount = appendMount("<button></button>");
    const clicked: Array<string> = [];
    const click: Action<CounterState> = (state) => {
      clicked.push("click");
      return state;
    };
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) =>
        h<CounterState>(
          "button",
          state.enabled ? { onclick: click } : {},
          text(state.enabled ? "on" : "off"),
        ),
      node: mount,
    });

    await flushRender();

    const button = requireElement("button") as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    dispatch({ ...initialState, enabled: false });
    await flushRender();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clicked).toEqual(["click"]);
    expect((button as RuntimeNode).events?.click).toBeUndefined();
  });

  test("handles DOM patch edge cases", async () => {
    const mount = appendMount("<div></div>");
    const clicked: Array<string> = [];
    const firstClick: Action<CounterState> = (state) => {
      clicked.push("first");
      return state;
    };
    const secondClick: Action<CounterState> = (state) => {
      clicked.push("second");
      return state;
    };
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) =>
        h<CounterState>(
          "div",
          {
            id: "edge",
            ...(state.enabled ? { style: { color: "blue" } } : {}),
          },
          [
            h<CounterState>("input", {
              value: state.enabled ? state.label : undefined,
            }),
            h<CounterState>(
              "button",
              { onclick: state.enabled ? firstClick : secondClick },
              text("event"),
            ),
            h<CounterState>("button", { is: "x-edge" }, text("customized")),
            state.enabled ? null : h<CounterState>("span", {}, text("appended")),
          ],
        ),
      node: mount,
    });

    await flushRender();

    const panel = requireElement("#edge") as HTMLElement;
    const input = requireElement("input") as HTMLInputElement;
    const button = requireElement("button") as HTMLButtonElement;

    expect(panel.style.color).toBe("blue");
    expect(input.value).toBe("start");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (button as RuntimeNode).events = {};
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    dispatch({ ...initialState, enabled: false });
    await flushRender();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panel.style.color).toBe("");
    expect(input.value).toBe("");
    expect(globalThis.document.body.querySelector("span")?.textContent).toBe(
      "appended",
    );
    expect(clicked).toEqual(["first", "second"]);

    const textMount = globalThis.document.createTextNode("server");
    globalThis.document.body.replaceChildren(textMount);

    app<string>({
      init: "client",
      view: (state) => text(state),
      node: textMount,
    });

    await flushRender();

    expect(globalThis.document.body.textContent).toBe("client");
  });

  test("skips queued renders when the app stops or the node is detached", async () => {
    const stoppedMount = appendMount("<div></div>");
    const stoppedDispatch = app<CounterState>({
      init: initialState,
      view: (state) => h<CounterState>("div", {}, text(state.label)),
      node: stoppedMount,
    });
    stoppedDispatch(null as unknown as CounterState);

    await flushRender();

    expect(globalThis.document.body.textContent).toBe("");

    const detachedMount = appendMount("<section></section>");

    app<CounterState>({
      init: initialState,
      view: (state) => h<CounterState>("section", {}, text(state.label)),
      node: detachedMount,
    });
    detachedMount.remove();

    await flushRender();

    expect(globalThis.document.body.textContent).toBe("");
  });

  test("patches child lists through head, tail, append, remove, and keyed middle paths", async () => {
    const mount = appendMount("<ol></ol>");
    const dispatch = app<Readonly<{ items: ReadonlyArray<string> }>>({
      init: { items: ["a", "b", "c"] },
      view: renderKeyedList,
      node: mount,
    });

    await flushRender();

    const firstA = requireElement("[data-id='a']");
    const firstB = requireElement("[data-id='b']");
    const firstC = requireElement("[data-id='c']");

    dispatch({ items: ["a", "b", "c", "d"] });
    await flushRender();

    expect(requireElement("[data-id='a']")).toBe(firstA);
    expect(requireElement("[data-id='b']")).toBe(firstB);
    expect(requireElement("[data-id='c']")).toBe(firstC);
    expect(globalThis.document.body.textContent).toBe("abcd");

    dispatch({ items: ["a", "c", "d"] });
    await flushRender();

    expect(requireElement("[data-id='a']")).toBe(firstA);
    expect(requireElement("[data-id='c']")).toBe(firstC);
    expect(globalThis.document.querySelector("[data-id='b']")).toBeNull();
    expect(globalThis.document.body.textContent).toBe("acd");

    dispatch({ items: ["a", "x", "c", "d"] });
    await flushRender();

    expect(requireElement("[data-id='a']")).toBe(firstA);
    expect(requireElement("[data-id='c']")).toBe(firstC);
    expect(globalThis.document.body.textContent).toBe("axcd");

    const firstD = requireElement("[data-id='d']");

    dispatch({ items: ["a", "d", "x", "c"] });
    await flushRender();

    expect(requireElement("[data-id='a']")).toBe(firstA);
    expect(requireElement("[data-id='c']")).toBe(firstC);
    expect(requireElement("[data-id='d']")).toBe(firstD);
    expect(globalThis.document.body.textContent).toBe("adxc");
  });

  test("removes a keyed child when the next child is false", async () => {
    const mount = appendMount("<div></div>");
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) =>
        h<CounterState>(
          "div",
          {},
          state.enabled
            ? h<CounterState>("span", { key: "optional" }, text("shown"))
            : false,
        ),
      node: mount,
    });

    await flushRender();
    expect(globalThis.document.body.textContent).toBe("shown");

    dispatch({ ...initialState, enabled: false });
    await flushRender();

    expect(globalThis.document.body.textContent).toBe("");
  });

  test("renders an empty text node for nullable root views", async () => {
    const mount = appendMount("<div>shown</div>");
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) =>
        state.enabled
          ? h<CounterState>("div", {}, text("shown"))
          : (false as unknown as VNode<CounterState>),
      node: mount,
    });

    await flushRender();
    dispatch({ ...initialState, enabled: false });
    await flushRender();

    expect(globalThis.document.body.textContent).toBe("");
  });

  test("reuses unkeyed children inside keyed middle patches", async () => {
    const mount = appendMount("<div></div>");
    const dispatch = app<Readonly<{ flip: boolean }>>({
      init: { flip: false },
      view: (state) =>
        h<Readonly<{ flip: boolean }>>(
          "div",
          {},
          state.flip
            ? [
                h<Readonly<{ flip: boolean }>>("span", { key: "b" }, text("b")),
                h<Readonly<{ flip: boolean }>>("em", {}, text("loose-next")),
                h<Readonly<{ flip: boolean }>>("span", { key: "a" }, text("a")),
                h<Readonly<{ flip: boolean }>>("span", { key: "c" }, text("c")),
                h<Readonly<{ flip: boolean }>>("span", { key: "d" }, text("d")),
              ]
            : [
                h<Readonly<{ flip: boolean }>>("span", { key: "a" }, text("a")),
                h<Readonly<{ flip: boolean }>>("em", {}, text("loose")),
                h<Readonly<{ flip: boolean }>>("strong", {}, text("extra")),
                h<Readonly<{ flip: boolean }>>("span", { key: "b" }, text("b")),
              ],
        ),
      node: mount,
    });

    await flushRender();

    const loose = requireElement("em");

    dispatch({ flip: true });
    await flushRender();

    expect(requireElement("em")).toBe(loose);
    expect(globalThis.document.querySelector("strong")).toBeNull();
    expect(globalThis.document.body.textContent).toBe("bloose-nextacd");
  });

  test("inserts missing keyed children when the middle grows", async () => {
    const mount = appendMount("<ol></ol>");
    const dispatch = app<Readonly<{ items: ReadonlyArray<string> }>>({
      init: { items: ["a", "b", "c"] },
      view: renderKeyedList,
      node: mount,
    });

    await flushRender();

    const firstA = requireElement("[data-id='a']");
    const firstC = requireElement("[data-id='c']");

    dispatch({ items: ["a", "x", "y", "z", "c"] });
    await flushRender();

    expect(requireElement("[data-id='a']")).toBe(firstA);
    expect(requireElement("[data-id='c']")).toBe(firstC);
    expect(globalThis.document.querySelector("[data-id='b']")).toBeNull();
    expect(globalThis.document.body.textContent).toBe("axyzc");
  });

  test("removes unkeyed children before a moved keyed child", async () => {
    const mount = appendMount("<div></div>");
    const dispatch = app<Readonly<{ flip: boolean }>>({
      init: { flip: false },
      view: (state) =>
        h<Readonly<{ flip: boolean }>>(
          "div",
          {},
          state.flip
            ? [
                h<Readonly<{ flip: boolean }>>("span", { key: "b" }, text("b")),
                h<Readonly<{ flip: boolean }>>("span", { key: "c" }, text("c")),
                h<Readonly<{ flip: boolean }>>("span", { key: "d" }, text("d")),
              ]
            : [
                h<Readonly<{ flip: boolean }>>("em", {}, text("loose")),
                h<Readonly<{ flip: boolean }>>("span", { key: "b" }, text("b")),
                h<Readonly<{ flip: boolean }>>("span", { key: "d" }, text("d")),
              ],
        ),
      node: mount,
    });

    await flushRender();

    dispatch({ flip: true });
    await flushRender();

    expect(globalThis.document.querySelector("em")).toBeNull();
    expect(globalThis.document.body.textContent).toBe("bcd");
  });

  test("reuses memoized views until memo data changes", async () => {
    const mount = appendMount("<div></div>");
    const renderLabels: Array<string> = [];
    const labelView = (data: Readonly<{ label: string }>): VNode<CounterState> => {
      renderLabels.push(data.label);
      return h<CounterState>("strong", {}, text(data.label));
    };
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) => h<CounterState>("div", {}, memo(labelView, { label: state.label })),
      node: mount,
    });

    await flushRender();
    dispatch({ ...initialState });
    await flushRender();
    dispatch({ ...initialState, label: "next" });
    await flushRender();

    expect(renderLabels).toEqual(["start", "next"]);
    expect(requireElement("strong").textContent).toBe("next");
  });

  test("memoizes primitive data by identity", async () => {
    const mount = appendMount("<div></div>");
    const renderLabels: Array<string> = [];
    const labelView = (label: string): VNode<CounterState> => {
      renderLabels.push(label);
      return h<CounterState>("strong", {}, text(label));
    };
    const dispatch = app<CounterState>({
      init: initialState,
      view: (state) => h<CounterState>("div", {}, memo(labelView, state.label)),
      node: mount,
    });

    await flushRender();
    dispatch({ ...initialState });
    await flushRender();

    expect(renderLabels).toEqual(["start"]);
  });
});

function renderKeyedList(state: Readonly<{ items: ReadonlyArray<string> }>): VNode<Readonly<{ items: ReadonlyArray<string> }>> {
  return h<Readonly<{ items: ReadonlyArray<string> }>>(
    "ol",
    {},
    state.items.map((item) =>
      h<Readonly<{ items: ReadonlyArray<string> }>>("li", { key: item, "data-id": item }, text(item)),
    ),
  );
}

function renderMixedView(state: CounterState): VNode<CounterState> {
  return h<CounterState>("div", { id: "mixed" }, [
    h(
      "ul",
      {},
      state.keyed.map((item) =>
        h<CounterState>("li", { key: item, "data-id": item }, text(item)),
      ),
    ),
    h(
      "input",
      {
        list: "choices",
        value: state.label,
        "data-object": state.customValue,
      },
      [],
    ),
    h<CounterState>("svg", {}, h<CounterState>("circle", { cx: 1, cy: 2, r: 3 }, [])),
    state.enabled ? text("nullable") : null,
    true,
    undefined,
  ]);
}

function appendMount(markup: string): Element {
  globalThis.document.body.insertAdjacentHTML("beforeend", markup);
  const mount = globalThis.document.body.firstElementChild;

  if (mount === null) {
    throw new Error("Expected mount element.");
  }

  return mount;
}

function requireElement(selector: string): Element {
  const element = globalThis.document.querySelector(selector);

  if (element === null) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

async function flushRender(): Promise<void> {
  await vi.runAllTimersAsync();
}

function eventFor(target: Element, type: string): Event {
  const event = new Event(type, { bubbles: true });
  target.dispatchEvent(event);
  return event;
}
