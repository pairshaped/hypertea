const elementNodeType = 1;
const textNodeType = 3;
const svgNamespace = "http://www.w3.org/2000/svg";

const emptyObject = Object.freeze({}) as Record<PropertyKey, never>;
const emptyArray = Object.freeze([]) as Array<never>;

export type Key = string | number;
export type Indexable =
  | string
  | ReadonlyArray<unknown>
  | Readonly<Record<string, unknown>>;
export type MemoView<State, Data extends Indexable = Indexable> = (
  data: Data,
) => VNode<State>;
type RuntimeNode = Node & {
  events?: Partial<Record<string, unknown>>;
};
type PatchableElement = Element & {
  [key: string]: unknown;
  style: CSSStyleDeclaration & Record<string, string>;
};
type PropsRecord = Readonly<Record<string, unknown>>;
type MountedVNode<State> = VNode<State> & { node: Node };
export type ProgramMsg = Readonly<{ type: string }>;
export type ProgramEffect = Readonly<{ type: string }>;

type ProgramEffecter<Model, Effect extends ProgramEffect> = (
  dispatch: Dispatch<Model>,
  effect: Effect,
) => void | Promise<void>;
type ProgramEffectTuple<Model, Effect extends ProgramEffect> = readonly [
  effecter: ProgramEffecter<Model, Effect>,
  payload: Effect,
];
type ProgramSubscriptionTuple<Model, Msg extends ProgramMsg> = readonly [
  subscriber: Subscriber<Model, ProgramSubscription<Msg>>,
  payload: ProgramSubscription<Msg>,
];

export type ClassProp =
  | boolean
  | string
  | undefined
  | null
  | Readonly<Record<string, boolean | undefined | null>>
  | ReadonlyArray<ClassProp>;

export type StyleProp = Partial<
  Readonly<Record<keyof CSSStyleDeclaration, string | null | undefined>>
> &
  Readonly<Record<`--${string}`, string | null | undefined>>;

/**
 * Low-level `app` callbacks are bivariant because one dispatch collection stores
 * heterogeneous payload types. Typed programs do not expose these callbacks.
 */
export type Action<State, Payload = unknown> = {
  bivarianceHack(state: State, payload: Payload): Dispatchable<State>;
}["bivarianceHack"];

export type Dispatch<State> = (
  dispatchable: Dispatchable<State>,
  payload?: unknown,
) => void;

export type Effecter<State, Payload = unknown> = {
  bivarianceHack(
    dispatch: Dispatch<State>,
    payload: Payload,
  ): void | Promise<void>;
}["bivarianceHack"];

export type Effect<State, Payload = unknown> =
  | Effecter<State, Payload>
  | readonly [effecter: Effecter<State, Payload>, payload: Payload];

export type MaybeEffect<State, Payload = unknown> =
  | Effect<State, Payload>
  | false
  | true
  | null
  | undefined
  | ""
  | 0;

export type Dispatchable<State, Payload = unknown> =
  | State
  | readonly [state: State, ...effects: Array<MaybeEffect<State, Payload>>]
  | Action<State, Payload>
  | readonly [action: Action<State, Payload>, payload: Payload];

export type Subscriber<State, Payload = unknown> = {
  bivarianceHack(dispatch: Dispatch<State>, payload: Payload): Unsubscribe;
}["bivarianceHack"];

export type Subscription<State, Payload = unknown> = readonly [
  subscriber: Subscriber<State, Payload>,
  payload: Payload,
];

export type MaybeSubscription<State, Payload = unknown> =
  | Subscription<State, Payload>
  | false
  | true
  | null
  | undefined;

export type Unsubscribe = () => void;

export type Props = PropsRecord & {
  readonly class?: ClassProp;
  readonly key?: Key | null | undefined;
  readonly style?: StyleProp;
  readonly [property: `on${string}`]: unknown;
};

/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/consistent-type-definitions, @typescript-eslint/consistent-indexed-object-style */
declare global {
  namespace JSX {
    type Element = VNode;

    interface ElementChildrenAttribute {
      children: unknown;
    }

    interface IntrinsicElements {
      [elementName: string]: Props;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace, @typescript-eslint/consistent-type-definitions, @typescript-eslint/consistent-indexed-object-style */

export type TypedH<State> = (
  tag: string,
  props?: Props,
  ...children: Array<Child<State>>
) => ElementVNode<State>;

export type ElementVNode<State> = {
  readonly tag: string | MemoView<State>;
  readonly props: Props;
  readonly key: Key | null | undefined;
  readonly children: Array<MaybeVNode<State>>;
  readonly type: 1;
  node: Node | undefined;
  memo?: Indexable;
};

export type TextVNode = {
  readonly tag: string;
  readonly props: Props;
  readonly key: undefined;
  readonly children: Array<never>;
  readonly type: 3;
  node: Node | undefined;
  memo?: Indexable;
};

export type VNode<State = unknown> = ElementVNode<State> | TextVNode;
export type MaybeVNode<State = unknown> = VNode<State> | boolean | null | undefined;
export type Child<State = unknown> =
  | MaybeVNode<State>
  | string
  | number
  | ReadonlyArray<Child<State>>;

export type App<State> = Readonly<{
  init?: Dispatchable<State>;
  view?: (state: State) => VNode<State>;
  node?: Node;
  subscriptions?: (state: State) => ReadonlyArray<MaybeSubscription<State>>;
  dispatch?: (dispatch: Dispatch<State>) => Dispatch<State>;
  nodeChanged?: (node: Element) => void;
}>;

export type EventBinding<Msg> = Readonly<{
  kind: "eventBinding";
  preventDefault: boolean;
  toMsg: (event: Event) => Msg;
}>;

export type BoundEvents<Msg> = Readonly<{
  changed: (message: Msg) => EventBinding<Msg>;
  checkedChanged: (toMessage: (value: boolean) => Msg) => EventBinding<Msg>;
  clicked: (message: Msg) => EventBinding<Msg>;
  dragEnded: (message: Msg) => EventBinding<Msg>;
  dragEntered: (message: Msg) => EventBinding<Msg>;
  dragStarted: (message: Msg) => EventBinding<Msg>;
  inputChanged: (toMessage: (value: string) => Msg) => EventBinding<Msg>;
  submitted: (message: Msg) => EventBinding<Msg>;
}>;

export type Viewport = Readonly<{
  width: number;
  height: number;
}>;

export type Transition<Model, Effect extends ProgramEffect> = readonly [
  model: Model,
  effects: ReadonlyArray<Effect>,
];

export type ProgramSubscriber<Msg extends ProgramMsg> = (
  dispatch: (message: Msg) => void,
) => Unsubscribe;

export type ProgramSubscription<Msg extends ProgramMsg> = Readonly<{
  key: string;
  subscribe: ProgramSubscriber<Msg>;
}>;

export type ProgramContext<Flags> = Readonly<{
  flags: Flags;
  node: HTMLElement;
}>;

export type Program<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = Readonly<{
  init: (flags: Flags) => Transition<Model, Effect>;
  update: (model: Model, message: Msg) => Transition<Model, Effect>;
  view: (model: Model) => VNode<Model>;
  subscriptions?: (
    model: Model,
    context: ProgramContext<Flags>,
  ) => ReadonlyArray<ProgramSubscription<Msg>>;
}>;

export type ProgramHandle<Model, Msg extends ProgramMsg> = Readonly<{
  model: () => Model;
  dispatch: (message: Msg) => void;
  settle: () => Promise<void>;
  stop: () => void;
}>;

type RuntimeBase<Model, Msg extends ProgramMsg, Effect extends ProgramEffect> = Readonly<{
  init: () => Transition<Model, Effect>;
  update: (model: Model, message: Msg) => Transition<Model, Effect>;
  view: (model: Model) => VNode<Model>;
  subscriptions?: (model: Model) => ReadonlyArray<ProgramSubscription<Msg>>;
  node: Element;
  nodeChanged?: (node: Element) => void;
}>;

type RuntimeEffects<Msg extends ProgramMsg, Effect extends ProgramEffect> = [Effect] extends [never]
  ? Readonly<{ runEffect?: never }>
  : Readonly<{
      runEffect: (
        dispatch: (message: Msg) => void,
        effect: Effect,
      ) => void | Promise<void>;
    }>;

export type Runtime<
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = RuntimeBase<
  Model,
  Msg,
  Effect
> &
  RuntimeEffects<Msg, Effect>;

type ProgramMountBase<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = Readonly<{
  flags: Flags;
  node: HTMLElement;
  program: Program<Flags, Model, Msg, Effect>;
}>;

type EffectlessProgramMount<Flags, Model, Msg extends ProgramMsg> =
  ProgramMountBase<Flags, Model, Msg, never> &
  Readonly<{ runEffect?: never }>;

type EffectfulProgramMount<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = ProgramMountBase<Flags, Model, Msg, Effect> &
  Readonly<{
    runEffect: (
      dispatch: (message: Msg) => void,
      effect: Effect,
      context: ProgramContext<Flags>,
    ) => void | Promise<void>;
  }>;

export type ProgramMount<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = [Effect] extends [never]
  ? EffectlessProgramMount<Flags, Model, Msg>
  : EffectfulProgramMount<Flags, Model, Msg, Effect>;

type IslandMountBase<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = Readonly<{
  selector: string;
  parseFlags: (value: unknown) => Flags;
  program: Program<Flags, Model, Msg, Effect>;
  preserveFallbackOnError?: boolean;
}>;

type EffectlessIslandMount<Flags, Model, Msg extends ProgramMsg> = IslandMountBase<
  Flags,
  Model,
  Msg,
  never
> &
  Readonly<{ runEffect?: never }>;

type EffectfulIslandMount<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = IslandMountBase<
  Flags,
  Model,
  Msg,
  Effect
> &
  Readonly<{
    runEffect: (
      dispatch: (message: Msg) => void,
      effect: Effect,
      context: ProgramContext<Flags>,
    ) => void | Promise<void>;
  }>;

export type IslandMount<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = [Effect] extends [never]
  ? EffectlessIslandMount<Flags, Model, Msg>
  : EffectfulIslandMount<Flags, Model, Msg, Effect>;

type RunningSubscription<State> = readonly [
  subscriber: Subscriber<State>,
  payload: unknown,
  unsubscribe: Unsubscribe,
];

type AppController<State> = Readonly<{
  dispatch: Dispatch<State>;
  model: () => State;
  settle: () => Promise<void>;
  stop: () => void;
}>;

const eventNames: Readonly<Record<string, string>> = {
  onBlur: "onblur",
  onChange: "onchange",
  onClick: "onclick",
  onDblClick: "ondblclick",
  onDragEnd: "ondragend",
  onDragEnter: "ondragenter",
  onDragStart: "ondragstart",
  onFocus: "onfocus",
  onInput: "oninput",
  onSubmit: "onsubmit",
};

let currentDispatch: ((message: unknown) => unknown) | undefined;

export function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}

export function noEffect<State>(): MaybeEffect<State> {
  return false;
}

export function text(value: unknown, node?: Node): TextVNode {
  return createVNode(String(value), emptyObject, emptyArray, textNodeType, node);
}

export function h<State = unknown>(
  tag: string,
  props?: Props,
  ...children: Array<Child<State>>
): ElementVNode<State> {
  const { class: classValue } = props ?? emptyObject;
  const key = props?.key;
  const nextProps: Record<string, unknown> = {};

  for (const name in props ?? emptyObject) {
    if (name !== "key" && name !== "class") {
      nextProps[eventNames[name] ?? name] = normalizePropValue(
        props?.[name],
      );
    }
  }

  const className = createClass(classValue);

  if (className.length > 0) {
    nextProps.class = className;
  }

  return createVNode(
    tag,
    nextProps as Props,
    flattenChildren(children),
    elementNodeType,
    undefined,
    key,
  );
}

export function fragment<State>(
  _props: Props | undefined,
  ...children: Array<Child<State>>
): Array<VNode<State>> {
  return flattenChildren(children);
}

export function typedH<State>(): TypedH<State> {
  return h;
}

export function memo<State, Data extends Indexable>(
  view: MemoView<State, Data>,
  data: Data,
): ElementVNode<State> {
  return {
    tag: view as MemoView<State>,
    props: emptyObject,
    key: undefined,
    children: [],
    type: elementNodeType,
    node: undefined,
    memo: data,
  };
}

export function bindEvents<Msg>(): BoundEvents<Msg> {
  return {
    changed,
    checkedChanged,
    clicked,
    dragEnded,
    dragEntered,
    dragStarted,
    inputChanged,
    submitted,
  };
}

export function changed<Msg>(message: Msg): EventBinding<Msg> {
  return eventBinding(() => message);
}

export function clicked<Msg>(message: Msg): EventBinding<Msg> {
  return eventBinding(() => message);
}

export function dragEnded<Msg>(message: Msg): EventBinding<Msg> {
  return eventBinding(() => message);
}

export function dragEntered<Msg>(message: Msg): EventBinding<Msg> {
  return eventBinding(() => message);
}

export function dragStarted<Msg>(message: Msg): EventBinding<Msg> {
  return eventBinding(() => message);
}

export function inputChanged<Msg>(
  toMessage: (value: string) => Msg,
): EventBinding<Msg> {
  return eventBinding((event) => toMessage(inputValue(event)));
}

export function checkedChanged<Msg>(
  toMessage: (value: boolean) => Msg,
): EventBinding<Msg> {
  return eventBinding((event) => toMessage(inputChecked(event)));
}

export function submitted<Msg>(message: Msg): EventBinding<Msg> {
  return { kind: "eventBinding", preventDefault: true, toMsg: () => message };
}

export function every<Msg extends ProgramMsg>(
  milliseconds: number,
  toMessage: () => Msg,
): ProgramSubscription<Msg> {
  return {
    key: `every:${String(milliseconds)}`,
    subscribe: (dispatch) => {
      const id = globalThis.setInterval(() => {
        dispatch(toMessage());
      }, milliseconds);
      return () => {
        globalThis.clearInterval(id);
      };
    },
  };
}

export function keyPressed<Msg extends ProgramMsg>(
  toMessage: (key: string) => Msg,
): ProgramSubscription<Msg> {
  return {
    key: "keyPressed",
    subscribe: (dispatch) => {
      const listener = (event: KeyboardEvent) => {
        dispatch(toMessage(event.key));
      };
      globalThis.addEventListener("keydown", listener);
      return () => {
        globalThis.removeEventListener("keydown", listener);
      };
    },
  };
}

export function windowResized<Msg extends ProgramMsg>(
  toMessage: (viewport: Viewport) => Msg,
): ProgramSubscription<Msg> {
  return {
    key: "windowResized",
    subscribe: (dispatch) => {
      const listener = () => {
        dispatch(
          toMessage({
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
          }),
        );
      };
      globalThis.addEventListener("resize", listener);
      const initial = globalThis.setTimeout(listener, 0);
      return () => {
        globalThis.clearTimeout(initial);
        globalThis.removeEventListener("resize", listener);
      };
    },
  };
}

export function defineProgram<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
>(program: Program<Flags, Model, Msg, Effect>): Program<Flags, Model, Msg, Effect> {
  return program;
}

export function start<Model, Msg extends ProgramMsg, Effect extends ProgramEffect>(
  runtime: Runtime<Model, Msg, Effect>,
): ProgramHandle<Model, Msg> {
  const [state, effects] = runtime.init();

  const dispatchMessage: Action<Model, Msg> = (model, message) => {
    const [next, nextEffects] = runtime.update(model, message);
    return [next, ...nextEffects.map(toEffectTuple)];
  };

  const runEffecter: ProgramEffecter<Model, Effect> = (
    dispatch,
    effect,
  ) => {
    const runEffect = runtime.runEffect;
    if (runEffect === undefined) {
      throw new Error("Effectless programs cannot produce effects");
    }
    return runEffect(
      (message) => {
        dispatch(dispatchMessage, message);
      },
      effect,
    );
  };

  const toEffectTuple = (
    effect: Effect,
  ): ProgramEffectTuple<Model, Effect> => {
    return [runEffecter, effect];
  };

  const runSubscriber: Subscriber<Model, ProgramSubscription<Msg>> = (
    dispatch,
    subscription,
  ) => {
    return subscription.subscribe((message) => {
      dispatch(dispatchMessage, message);
    });
  };

  const toSubscriptionTuple = (
    subscription: ProgramSubscription<Msg>,
  ): ProgramSubscriptionTuple<Model, Msg> => {
    return [runSubscriber, subscription];
  };

  const init: Dispatchable<Model> = [state, ...effects.map(toEffectTuple)];
  const props: App<Model> = {
    init,
    view: (model: Model) =>
      withDispatch(
        (message) => [dispatchMessage, message as Msg],
        () => runtime.view(model),
      ),
    node: runtime.node,
    ...(runtime.nodeChanged === undefined ? {} : { nodeChanged: runtime.nodeChanged }),
  };

  const subscriptions = runtime.subscriptions;

  const controller = createApp<Model>(
    subscriptions === undefined
      ? props
      : {
          ...props,
          subscriptions: (model) => subscriptions(model).map(toSubscriptionTuple),
        },
  );

  return {
    model: controller.model,
    dispatch: (message) => {
      controller.dispatch(dispatchMessage, message);
    },
    settle: controller.settle,
    stop: controller.stop,
  };
}

export function mountProgram<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
>(options: ProgramMount<Flags, Model, Msg, Effect>): ProgramHandle<Model, Msg> {
  const { flags, node, program } = options;
  let currentNode = node;
  const context = { flags, get node() { return currentNode; } } as ProgramContext<Flags>;
  const subscriptions = program.subscriptions;
  const runEffect = options.runEffect;
  const runtime = {
    node,
    nodeChanged: (nextNode: Element) => {
      if (nextNode instanceof HTMLElement) currentNode = nextNode;
    },
    init: () => program.init(flags),
    update: program.update,
    view: program.view,
    ...(subscriptions === undefined
      ? {}
      : { subscriptions: (model: Model) => subscriptions(model, context) }),
    ...(runEffect === undefined
      ? {}
      : {
          runEffect: (dispatch: (message: Msg) => void, effect: Effect) =>
            runEffect(dispatch, effect, context),
        }),
  } as unknown as Runtime<Model, Msg, Effect>;

  return start(runtime);
}

export function mountIslands<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
>(
  options: EffectfulIslandMount<Flags, Model, Msg, Effect>,
): void;
export function mountIslands<Flags, Model, Msg extends ProgramMsg>(
  options: EffectlessIslandMount<Flags, Model, Msg>,
): void;
export function mountIslands<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
>(
  options:
    | EffectfulIslandMount<Flags, Model, Msg, Effect>
    | EffectlessIslandMount<Flags, Model, Msg>,
): void {
  if (typeof globalThis.document === "undefined") {
    return;
  }

  globalThis.document.querySelectorAll(options.selector).forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    try {
      const rawFlags = node.dataset.flags;
      if (rawFlags === undefined) {
        throw new Error("Missing data-flags");
      }
      const flags = options.parseFlags(JSON.parse(rawFlags) as unknown);
      const runEffect = options.runEffect;
      const mount = {
        flags,
        node,
        program: options.program,
        ...(runEffect === undefined
          ? {}
          : { runEffect }),
        // Conditional generics lose their exact optional-property relationships here.
      } as unknown as ProgramMount<Flags, Model, Msg, Effect>;
      mountProgram(mount);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown flags error";
      globalThis.console.error(`Unable to mount island ${options.selector}: ${detail}`);
      if (options.preserveFallbackOnError === true) {
        node.dataset.islandError = detail;
        return;
      }
      const alert = globalThis.document.createElement("div");
      alert.className = "alert-destructive";
      alert.dataset.islandError = "";
      alert.setAttribute("role", "alert");
      alert.setAttribute("title", detail);
      alert.textContent = "This section could not be loaded.";
      node.replaceChildren(alert);
    }
  });
}

export function app<State>({
  ...options
}: App<State>): Dispatch<State> {
  return createApp(options).dispatch;
}

function createApp<State>({
  node,
  view,
  subscriptions,
  dispatch = identityDispatch,
  init = emptyObject,
  nodeChanged,
}: App<State>): AppController<State> {
  let vdom: VNode<State> | undefined =
    node === undefined ? undefined : recycleNode<State>(node);
  let runningSubscriptions: Array<RunningSubscription<State> | undefined> = [];
  let state: State | undefined;
  let active = true;
  let busy = false;
  let pendingRender = Promise.resolve();
  let finishRender: (() => void) | undefined;

  const stop = (): void => {
    if (!active) {
      return;
    }

    active = false;
    runningSubscriptions = stopSubscriptions(runningSubscriptions);
    finishRender?.();
    finishRender = undefined;
  };

  const listener = function listener(this: RuntimeNode, event: Event) {
    const dispatchable = this.events?.[event.type];

    if (dispatchable !== undefined) {
      managedDispatch(dispatchable as Dispatchable<State>, event);
    }
  } as EventListener;

  const update = (nextState: State): void => {
    if (!active || Object.is(state, nextState)) {
      return;
    }

    state = nextState;

    if (state === null || state === undefined) {
      stop();
      return;
    }

    if (subscriptions !== undefined) {
      runningSubscriptions = patchSubscriptions(
        runningSubscriptions,
        subscriptions(state),
        managedDispatch,
      );
    }

    if (view !== undefined && node !== undefined && !busy) {
      busy = true;
      pendingRender = new Promise((resolve) => {
        finishRender = resolve;
      });
      enqueue(() => {
        busy = false;
        try {
          if (active && state !== undefined && node !== undefined) {
            const parent = node.parentNode;

            if (parent !== null) {
              const nextVNode = view(state);
              node = patch(
                parent,
                node,
                vdom,
                nextVNode,
                listener,
                false,
              );
              if (node instanceof Element) nodeChanged?.(node);
              vdom = nextVNode;
            }
          }
        } finally {
          finishRender?.();
          finishRender = undefined;
        }
      });
    }
  };

  const runDispatchable = (
    dispatchable: Dispatchable<State>,
    payload?: unknown,
  ): void => {
    if (!active) {
      return;
    }

    if (typeof dispatchable === "function") {
      const action = dispatchable as Action<State>;
      runDispatchable(action(state as State, payload));
      return;
    }

    if (Array.isArray(dispatchable)) {
      const [first, second, ...effects] = dispatchable as ReadonlyArray<unknown>;

      if (typeof first === "function") {
        runDispatchable(
          (first as Action<State>)(state as State, second),
        );
        return;
      }

      update(first as State);
      runEffects([second, ...effects] as Array<MaybeEffect<State>>, managedDispatch);
      return;
    }

    update(dispatchable as State);
  };

  const managedDispatch = dispatch((dispatchable, payload) => {
    runDispatchable(dispatchable, payload);
  });

  managedDispatch(init);

  return {
    dispatch: managedDispatch,
    model: () => state as State,
    settle: () => pendingRender,
    stop,
  };
}

function identityDispatch<State>(dispatch: Dispatch<State>): Dispatch<State> {
  return dispatch;
}

function createVNode<State, Type extends 1 | 3>(
  tag: string,
  props: Props,
  children: Array<MaybeVNode<State>>,
  type: Type,
  node?: Node,
  key?: Key | null,
): Type extends 1 ? ElementVNode<State> : TextVNode {
  return {
    tag,
    props,
    key,
    children,
    type,
    node,
  } as Type extends 1 ? ElementVNode<State> : TextVNode;
}

function createClass(value: ClassProp): string {
  if (typeof value === "string") {
    return value;
  }

  let className = "";

  if (isClassArray(value)) {
    for (const item of value) {
      const next = createClass(item);

      if (next.length > 0) {
        className += `${className.length > 0 ? " " : ""}${next}`;
      }
    }

    return className;
  }

  if (isClassRecord(value)) {
    for (const name in value) {
      if (value[name] === true) {
        className += `${className.length > 0 ? " " : ""}${name}`;
      }
    }

    return className;
  }

  return "";
}

function eventBinding<Msg>(
  toMessage: (event: Event) => Msg,
): EventBinding<Msg> {
  return { kind: "eventBinding", preventDefault: false, toMsg: toMessage };
}

function normalizePropValue(value: unknown): unknown {
  if (!isEventBinding(value)) {
    return value;
  }

  const dispatch = currentDispatch;

  if (dispatch === undefined) {
    throw new Error("Event helpers can only be used while rendering a view");
  }

  return (_state: unknown, event: Event) => {
    if (value.preventDefault) {
      event.preventDefault();
    }

    return dispatch(value.toMsg(event));
  };
}

function withDispatch<State>(
  dispatch: (message: unknown) => unknown,
  render: () => VNode<State>,
): VNode<State> {
  const previousDispatch = currentDispatch;
  currentDispatch = dispatch;

  try {
    return render();
  } finally {
    currentDispatch = previousDispatch;
  }
}

function isEventBinding(value: unknown): value is EventBinding<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "eventBinding"
  );
}

function inputValue(event: Event): string {
  const target = event.target;

  if (target instanceof HTMLInputElement) {
    return target.value;
  }

  if (target instanceof HTMLSelectElement) {
    return target.value;
  }

  if (target instanceof HTMLTextAreaElement) {
    return target.value;
  }

  return "";
}

function inputChecked(event: Event): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement && target.checked;
}

function flattenChildren<State>(
  children: ReadonlyArray<Child<State>>,
): Array<VNode<State>> {
  const flattened: Array<VNode<State>> = [];

  for (const child of children) {
    if (Array.isArray(child)) {
      flattened.push(...flattenChildren<State>(child));
      continue;
    }

    if (child === undefined || child === null || child === false || child === true) {
      continue;
    }

    if (typeof child === "string" || typeof child === "number") {
      flattened.push(text(child));
      continue;
    }

    flattened.push(child as VNode<State>);
  }

  return flattened;
}

function isClassArray(value: ClassProp): value is ReadonlyArray<ClassProp> {
  return Array.isArray(value);
}

function isClassRecord(
  value: ClassProp,
): value is Readonly<Record<string, boolean | undefined | null>> {
  return value !== null && typeof value === "object" && !isClassArray(value);
}

function enqueue(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(callback);
    return;
  }

  globalThis.setTimeout(callback, 0);
}

function runEffects<State>(
  effects: ReadonlyArray<MaybeEffect<State>>,
  dispatch: Dispatch<State>,
): void {
  for (const effect of effects) {
    if (effect === false || effect === true || effect == null || effect === "" || effect === 0) {
      continue;
    }

    if (Array.isArray(effect)) {
      const [effecter, payload] = effect as readonly [Effecter<State>, unknown];
      void effecter(dispatch, payload);
      continue;
    }

    void (effect as Effecter<State>)(dispatch, undefined);
  }
}

function patchSubscriptions<State>(
  oldSubscriptions: ReadonlyArray<RunningSubscription<State> | undefined>,
  newSubscriptions: ReadonlyArray<MaybeSubscription<State>>,
  dispatch: Dispatch<State>,
): Array<RunningSubscription<State> | undefined> {
  const maxLength = Math.max(oldSubscriptions.length, newSubscriptions.length);
  const nextSubscriptions: Array<RunningSubscription<State> | undefined> = [];

  for (let index = 0; index < maxLength; index += 1) {
    const oldSubscription = oldSubscriptions[index];
    const newSubscription = newSubscriptions[index];

    if (
      newSubscription === false ||
      newSubscription === true ||
      newSubscription == null
    ) {
      oldSubscription?.[2]();
      nextSubscriptions.push(undefined);
      continue;
    }

    if (oldSubscription?.[0] !== newSubscription[0]) {
      oldSubscription?.[2]();
      nextSubscriptions.push([
        newSubscription[0],
        newSubscription[1],
        newSubscription[0](dispatch, newSubscription[1]),
      ]);
      continue;
    }

    if (shouldRestart(newSubscription[1], oldSubscription[1])) {
      oldSubscription[2]();
      nextSubscriptions.push([
        newSubscription[0],
        newSubscription[1],
        newSubscription[0](dispatch, newSubscription[1]),
      ]);
      continue;
    }

    nextSubscriptions.push(oldSubscription);
  }

  return nextSubscriptions;
}

function stopSubscriptions<State>(
  subscriptions: ReadonlyArray<RunningSubscription<State> | undefined>,
): Array<undefined> {
  for (const subscription of subscriptions) {
    subscription?.[2]();
  }

  return [];
}

function shouldRestart(nextPayload: unknown, oldPayload: unknown): boolean {
  if (!isPlainPayload(nextPayload) || !isPlainPayload(oldPayload)) {
    return !Object.is(nextPayload, oldPayload);
  }

  for (const key in nextPayload) {
    if (shouldPreservePayloadValue(nextPayload, oldPayload, key)) {
      continue;
    }

    if (!Object.is(nextPayload[key], oldPayload[key])) {
      return true;
    }
  }

  for (const key in oldPayload) {
    if (!(key in nextPayload)) {
      return true;
    }
  }

  return false;
}

function shouldPreservePayloadValue(
  nextPayload: Record<string, unknown>,
  oldPayload: Record<string, unknown>,
  key: string,
): boolean {
  const nextValue = nextPayload[key];

  if (
    (Array.isArray(nextValue) && typeof nextValue[0] === "function") ||
    typeof nextValue === "function"
  ) {
    nextPayload[key] = oldPayload[key];
    return true;
  }

  return false;
}

function isPlainPayload(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function patchProperty(
  node: PatchableElement,
  key: string,
  oldValue: unknown,
  newValue: unknown,
  listener: EventListener,
  isSvg: boolean,
): void {
  if (key === "style") {
    patchStyle(node.style, oldValue, newValue);
    return;
  }

  if (key.startsWith("on")) {
    patchEvent(node, key.slice(2), oldValue, newValue, listener);
    return;
  }

  if (!isSvg && key !== "list" && key !== "form" && key in node) {
    node[key] = newValue ?? "";
    return;
  }

  if (newValue === false || newValue == null) {
    node.removeAttribute(key);
    return;
  }

  node.setAttribute(key, createAttributeValue(newValue));
}

function createAttributeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return value.toString();
  }

  return "";
}

function patchStyle(
  style: CSSStyleDeclaration & Record<string, string>,
  oldValue: unknown,
  newValue: unknown,
): void {
  const oldStyle = isPlainPayload(oldValue) ? oldValue : {};
  const newStyle = isPlainPayload(newValue) ? newValue : {};

  for (const key in oldStyle) {
    if (!(key in newStyle)) {
      setStyleValue(style, key, "");
    }
  }

  for (const key in newStyle) {
    const value = newStyle[key];
    setStyleValue(style, key, typeof value === "string" ? value : "");
  }
}

function setStyleValue(
  style: CSSStyleDeclaration & Record<string, string>,
  key: string,
  value: string,
): void {
  if (key.startsWith("-")) {
    style.setProperty(key, value);
    return;
  }

  style[key] = value;
}

function patchEvent(
  node: RuntimeNode,
  eventName: string,
  oldValue: unknown,
  newValue: unknown,
  listener: EventListener,
): void {
  node.events = {
    ...(node.events ?? {}),
    [eventName]: newValue,
  };

  if (newValue == null || newValue === false) {
    node.removeEventListener(eventName, listener);
    return;
  }

  if (oldValue == null || oldValue === false) {
    node.addEventListener(eventName, listener);
  }
}

function createNode<State>(
  vdom: VNode<State>,
  listener: EventListener,
  isSvg: boolean,
): Node {
  const node =
    vdom.type === textNodeType
      ? globalThis.document.createTextNode(vdom.tag)
      : createElement(vdom, isSvg);

  if (vdom.type === elementNodeType) {
    const element = node as PatchableElement;
    const nextSvg = isSvg || vdom.tag === "svg";

    for (const [key, value] of Object.entries(vdom.props)) {
      if (patchAfterChildren(vdom.tag, key)) continue;
      patchProperty(element, key, undefined, value, listener, nextSvg);
    }

    for (let index = 0; index < vdom.children.length; index += 1) {
      const child = maybeVNode(vdom.children[index]);
      vdom.children[index] = child;
      node.appendChild(createNode(child, listener, nextSvg));
    }

    patchDeferredProperties(element, vdom.tag, emptyObject, vdom.props, listener, nextSvg);
  }

  vdom.node = node;
  return node;
}

function createElement<State>(vdom: ElementVNode<State>, isSvg: boolean): Element {
  const options =
    typeof vdom.props.is === "string" ? { is: vdom.props.is } : undefined;

  if (isSvg || vdom.tag === "svg") {
    return globalThis.document.createElementNS(
      svgNamespace,
      vdom.tag as string,
      options,
    );
  }

  return globalThis.document.createElement(vdom.tag as string, options);
}

function patch<State>(
  parent: Node,
  node: Node,
  oldVNode: VNode<State> | undefined,
  newVNode: MaybeVNode<State>,
  listener: EventListener,
  isSvg: boolean,
): Node {
  const normalizedNewVNode = maybeVNode(newVNode, oldVNode);

  if (oldVNode === normalizedNewVNode) {
    return node;
  }

  if (oldVNode?.type === textNodeType && normalizedNewVNode.type === textNodeType) {
    if (oldVNode.tag !== normalizedNewVNode.tag) {
      node.nodeValue = normalizedNewVNode.tag;
    }

    normalizedNewVNode.node = node;
    return node;
  }

  if (oldVNode?.tag !== normalizedNewVNode.tag) {
    const nextNode = createNode(normalizedNewVNode, listener, isSvg);
    parent.insertBefore(nextNode, node);

    if (oldVNode?.node !== undefined) {
      parent.removeChild(oldVNode.node);
    }

    normalizedNewVNode.node = nextNode;
    return nextNode;
  }

  const nextNode = patchElement(
    node,
    oldVNode as ElementVNode<State>,
    normalizedNewVNode as ElementVNode<State>,
    listener,
    isSvg,
  );
  normalizedNewVNode.node = nextNode;
  return nextNode;
}

function patchElement<State>(
  node: Node,
  oldVNode: ElementVNode<State>,
  newVNode: ElementVNode<State>,
  listener: EventListener,
  isSvg: boolean,
): Node {
  const element = node as PatchableElement;
  const nextSvg = isSvg || newVNode.tag === "svg";

  for (const key in oldVNode.props) {
    if (patchAfterChildren(newVNode.tag, key)) continue;
    const oldValue = oldVNode.props[key];
    const newValue = newVNode.props[key];
    patchChangedProperty(element, key, oldValue, newValue, listener, nextSvg);
  }

  for (const key in newVNode.props) {
    if (patchAfterChildren(newVNode.tag, key)) continue;
    if (!(key in oldVNode.props)) {
      patchChangedProperty(
        element,
        key,
        undefined,
        newVNode.props[key],
        listener,
        nextSvg,
      );
    }
  }

  patchChildren(element, oldVNode.children, newVNode.children, listener, nextSvg);
  patchDeferredProperties(
    element,
    newVNode.tag,
    oldVNode.props,
    newVNode.props,
    listener,
    nextSvg,
  );
  newVNode.node = node;
  return node;
}

function patchDeferredProperties(
  element: PatchableElement,
  tag: string | MemoView<unknown>,
  oldProps: Props,
  newProps: Props,
  listener: EventListener,
  isSvg: boolean,
): void {
  if (!patchAfterChildren(tag, "value")) return;
  if (!("value" in oldProps) && !("value" in newProps)) return;
  patchChangedProperty(element, "value", oldProps.value, newProps.value, listener, isSvg);
}

function patchAfterChildren(tag: string | MemoView<unknown>, key: string): boolean {
  return tag === "select" && key === "value";
}

function patchChangedProperty(
  element: PatchableElement,
  key: string,
  oldValue: unknown,
  newValue: unknown,
  listener: EventListener,
  isSvg: boolean,
): void {
  const currentValue =
    key === "value" || key === "selected" || key === "checked"
      ? element[key]
      : oldValue;

  if (!Object.is(currentValue, newValue)) {
    patchProperty(element, key, oldValue, newValue, listener, isSvg);
  }
}

function patchChildren<State>(
  parent: Node,
  oldChildren: Array<MaybeVNode<State>>,
  newChildren: Array<MaybeVNode<State>>,
  listener: EventListener,
  isSvg: boolean,
): void {
  let oldHead = 0;
  let newHead = 0;
  let oldTail = oldChildren.length - 1;
  let newTail = newChildren.length - 1;

  while (oldHead <= oldTail && newHead <= newTail) {
    const oldChild = maybeVNode(oldChildren[oldHead]);
    const oldKey = oldChild.key;

    if (oldKey === undefined || oldKey === null || oldKey !== getKey(newChildren[newHead])) {
      break;
    }

    newChildren[newHead] = patchMatchedChild(
      parent,
      oldChild,
      newChildren[newHead],
      listener,
      isSvg,
    );
    oldChildren[oldHead] = oldChild;
    oldHead += 1;
    newHead += 1;
  }

  while (oldHead <= oldTail && newHead <= newTail) {
    const oldChild = maybeVNode(oldChildren[oldTail]);
    const oldKey = oldChild.key;

    if (oldKey === undefined || oldKey === null || oldKey !== getKey(newChildren[newTail])) {
      break;
    }

    newChildren[newTail] = patchMatchedChild(
      parent,
      oldChild,
      newChildren[newTail],
      listener,
      isSvg,
    );
    oldChildren[oldTail] = oldChild;
    oldTail -= 1;
    newTail -= 1;
  }

  if (oldHead > oldTail) {
    insertNewChildren(parent, oldChildren, newChildren, newHead, newTail, listener, isSvg);
    return;
  }

  if (newHead > newTail) {
    removeOldChildren(parent, oldChildren, oldHead, oldTail);
    return;
  }

  if (
    allUnkeyed(oldChildren, oldHead, oldTail) &&
    allUnkeyed(newChildren, newHead, newTail)
  ) {
    patchUnkeyedMiddle(
      parent,
      oldChildren,
      newChildren,
      oldHead,
      oldTail,
      newHead,
      newTail,
      listener,
      isSvg,
    );
    return;
  }

  patchKeyedMiddle(
    parent,
    oldChildren,
    newChildren,
    oldHead,
    oldTail,
    newHead,
    newTail,
    listener,
    isSvg,
  );
}

function patchMatchedChild<State>(
  parent: Node,
  oldChild: VNode<State>,
  newChild: MaybeVNode<State>,
  listener: EventListener,
  isSvg: boolean,
): VNode<State> {
  const normalizedNewChild = maybeVNode(newChild, oldChild);
  patch(
    parent,
    mountedVNode(oldChild).node,
    oldChild,
    normalizedNewChild,
    listener,
    isSvg,
  );
  return normalizedNewChild;
}

function insertNewChildren<State>(
  parent: Node,
  oldChildren: Array<MaybeVNode<State>>,
  newChildren: Array<MaybeVNode<State>>,
  newHead: number,
  newTail: number,
  listener: EventListener,
  isSvg: boolean,
): void {
  const anchor = getNode(oldChildren[newHead]);

  while (newHead <= newTail) {
    const child = maybeVNode(newChildren[newHead]);
    newChildren[newHead] = child;
    parent.insertBefore(createNode(child, listener, isSvg), anchor);
    newHead += 1;
  }
}

function insertNewChildrenBefore<State>(
  parent: Node,
  newChildren: Array<MaybeVNode<State>>,
  newHead: number,
  newTail: number,
  anchor: Node | null,
  listener: EventListener,
  isSvg: boolean,
): void {
  while (newHead <= newTail) {
    const child = maybeVNode(newChildren[newHead]);
    newChildren[newHead] = child;
    parent.insertBefore(createNode(child, listener, isSvg), anchor);
    newHead += 1;
  }
}

function removeOldChildren<State>(
  parent: Node,
  oldChildren: Array<MaybeVNode<State>>,
  oldHead: number,
  oldTail: number,
): void {
  while (oldHead <= oldTail) {
    removeChild(parent, maybeVNode(oldChildren[oldHead]));
    oldHead += 1;
  }
}

function allUnkeyed<State>(
  children: Array<MaybeVNode<State>>,
  head: number,
  tail: number,
): boolean {
  while (head <= tail) {
    if (getKey(children[head]) !== undefined && getKey(children[head]) !== null) {
      return false;
    }

    head += 1;
  }

  return true;
}

function patchUnkeyedMiddle<State>(
  parent: Node,
  oldChildren: Array<MaybeVNode<State>>,
  newChildren: Array<MaybeVNode<State>>,
  oldHead: number,
  oldTail: number,
  newHead: number,
  newTail: number,
  listener: EventListener,
  isSvg: boolean,
): void {
  while (oldHead <= oldTail && newHead <= newTail) {
    const oldChild = maybeVNode(oldChildren[oldHead]);
    const newChild = maybeVNode(newChildren[newHead], oldChild);
    newChildren[newHead] = newChild;
    oldChildren[oldHead] = oldChild;
    patch(
      parent,
      mountedVNode(oldChild).node,
      oldChild,
      newChild,
      listener,
      isSvg,
    );
    oldHead += 1;
    newHead += 1;
  }

  insertNewChildren(parent, oldChildren, newChildren, newHead, newTail, listener, isSvg);
  removeOldChildren(parent, oldChildren, oldHead, oldTail);
}

function patchKeyedMiddle<State>(
  parent: Node,
  oldChildren: Array<MaybeVNode<State>>,
  newChildren: Array<MaybeVNode<State>>,
  oldHead: number,
  oldTail: number,
  newHead: number,
  newTail: number,
  listener: EventListener,
  isSvg: boolean,
): void {
  const oldKeyed = new Map<Key, VNode<State>>();
  const newKeyed = new Set<Key>();

  for (let index = oldHead; index <= oldTail; index += 1) {
    const oldChild = maybeVNode(oldChildren[index]);
    oldChildren[index] = oldChild;

    if (oldChild.key !== undefined && oldChild.key !== null) {
      oldKeyed.set(oldChild.key, oldChild);
    }
  }

  while (newHead <= newTail) {
    if (oldHead > oldTail) {
      insertNewChildrenBefore(
        parent,
        newChildren,
        newHead,
        newTail,
        getNode(oldChildren[oldHead]),
        listener,
        isSvg,
      );
      break;
    }

    const oldChild = maybeVNode(oldChildren[oldHead]);
    const oldKey = oldChild.key;
    const newChild = maybeVNode(newChildren[newHead], oldChild);
    const newKey = newChild.key;
    oldChildren[oldHead] = oldChild;
    newChildren[newHead] = newChild;

    if (
      (oldKey !== undefined && oldKey !== null && newKeyed.has(oldKey)) ||
      (newKey !== undefined &&
        newKey !== null &&
        newKey === getKey(oldChildren[oldHead + 1]))
    ) {
      if (oldKey === undefined || oldKey === null) {
        removeChild(parent, oldChild);
      }

      oldHead += 1;
      continue;
    }

    if (newKey === undefined || newKey === null) {
      if (oldKey === undefined || oldKey === null) {
        patch(
          parent,
          mountedVNode(oldChild).node,
          oldChild,
          newChild,
          listener,
          isSvg,
        );
        newHead += 1;
      }

      oldHead += 1;
      continue;
    }

    if (oldKey === newKey) {
      patch(
        parent,
        mountedVNode(oldChild).node,
        oldChild,
        newChild,
        listener,
        isSvg,
      );
      newKeyed.add(newKey);
      oldHead += 1;
      newHead += 1;
      continue;
    }

    const keyedChild = oldKeyed.get(newKey);

    if (keyedChild === undefined) {
      patch(
        parent,
        mountedVNode(oldChild).node,
        undefined,
        newChild,
        listener,
        isSvg,
      );
    } else {
      patch(
        parent,
        parent.insertBefore(mountedVNode(keyedChild).node, mountedVNode(oldChild).node),
        keyedChild,
        newChild,
        listener,
        isSvg,
      );
      newKeyed.add(newKey);
    }

    newHead += 1;
  }

  while (oldHead <= oldTail) {
    const oldChild = maybeVNode(oldChildren[oldHead]);
    oldChildren[oldHead] = oldChild;

    if (oldChild.key === undefined || oldChild.key === null) {
      removeChild(parent, oldChild);
    }

    oldHead += 1;
  }

  for (const [key, oldChild] of oldKeyed) {
    if (!newKeyed.has(key)) {
      removeChild(parent, oldChild);
    }
  }
}

function getKey<State>(child: MaybeVNode<State>): Key | null | undefined {
  return child === false || child === true || child == null ? undefined : child.key;
}

function getNode<State>(child: MaybeVNode<State>): Node | null {
  return child === false || child === true || child == null
    ? null
    : mountedVNode(child).node;
}

function removeChild<State>(parent: Node, child: VNode<State>): void {
  parent.removeChild(mountedVNode(child).node);
}

function mountedVNode<State>(child: VNode<State>): MountedVNode<State> {
  return child as MountedVNode<State>;
}

function recordsChanged(a: PropsRecord, b: PropsRecord): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of keys) {
    if (!Object.is(a[key], b[key])) {
      return true;
    }
  }

  return false;
}

function memoDataChanged(a: Indexable, b: Indexable): boolean {
  if (!isPlainPayload(a) || !isPlainPayload(b)) {
    return !Object.is(a, b);
  }

  return recordsChanged(a, b);
}

function maybeVNode<State>(
  newVNode: MaybeVNode<State>,
  oldVNode?: VNode<State>,
): VNode<State> {
  if (newVNode === false || newVNode === true || newVNode == null) {
    return text("");
  }

  if (typeof newVNode.tag !== "function") {
    return newVNode;
  }

  const memoData = (newVNode as ElementVNode<State> & { memo: Indexable }).memo;

  if (
    oldVNode?.memo === undefined ||
    memoDataChanged(oldVNode.memo, memoData)
  ) {
    const rendered = newVNode.tag(memoData);
    rendered.memo = memoData;
    return rendered;
  }

  return oldVNode;
}

function recycleNode<State>(node: Node): VNode<State> {
  if (node.nodeType === textNodeType) {
    return text(node.nodeValue, node);
  }

  return createVNode(
    node.nodeName.toLowerCase(),
    emptyObject,
    Array.from(node.childNodes, (child) => recycleNode<State>(child)),
    elementNodeType,
    node,
  );
}
