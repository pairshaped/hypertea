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

export type Props<State> = PropsRecord & {
  readonly class?: ClassProp;
  readonly key?: Key | null | undefined;
  readonly style?: StyleProp;
  readonly [property: `on${string}`]: Dispatchable<State> | undefined;
};

export type TypedH<State> = (
  tag: string,
  props: Props<State>,
  children?: MaybeVNode<State> | ReadonlyArray<MaybeVNode<State>>,
) => ElementVNode<State>;

export type ElementVNode<State> = {
  readonly tag: string | MemoView<State>;
  readonly props: Props<State>;
  readonly key: Key | null | undefined;
  readonly children: Array<MaybeVNode<State>>;
  readonly type: 1;
  node: Node | undefined;
  memo?: Indexable;
};

export type TextVNode = {
  readonly tag: string;
  readonly props: Props<never>;
  readonly key: undefined;
  readonly children: Array<never>;
  readonly type: 3;
  node: Node | undefined;
  memo?: Indexable;
};

export type VNode<State> = ElementVNode<State> | TextVNode;
export type MaybeVNode<State> = VNode<State> | boolean | null | undefined;

export type App<State> = Readonly<{
  init?: Dispatchable<State>;
  view?: (state: State) => VNode<State>;
  node?: Node;
  subscriptions?: (state: State) => ReadonlyArray<MaybeSubscription<State>>;
  dispatch?: (dispatch: Dispatch<State>) => Dispatch<State>;
}>;

type RunningSubscription<State> = readonly [
  subscriber: Subscriber<State>,
  payload: unknown,
  unsubscribe: Unsubscribe,
];

export function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}

export function noEffect<State>(): MaybeEffect<State> {
  return false;
}

export function text(value: unknown, node?: Node): TextVNode {
  return createVNode(String(value), emptyObject, emptyArray, textNodeType, node);
}

export function h<State>(
  tag: string,
  props: Props<State>,
  children: MaybeVNode<State> | ReadonlyArray<MaybeVNode<State>> = emptyArray,
): ElementVNode<State> {
  const { class: classValue } = props;
  const key = props.key;
  const rest = Object.fromEntries(
    Object.entries(props).filter(
      ([name]) => name !== "key" && name !== "class",
    ),
  ) as Props<State>;
  const className = createClass(classValue);
  const nextProps =
    className.length > 0 ? { ...rest, class: className } : { ...rest };

  return createVNode(
    tag,
    nextProps,
    isArrayOfChildren(children) ? [...children] : [children],
    elementNodeType,
    undefined,
    key,
  );
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

export function app<State>({
  node,
  view,
  subscriptions,
  dispatch = identityDispatch,
  init = emptyObject,
}: App<State>): Dispatch<State> {
  let vdom: VNode<State> | undefined =
    node === undefined ? undefined : recycleNode<State>(node);
  let runningSubscriptions: Array<RunningSubscription<State> | undefined> = [];
  let state: State | undefined;
  let active = true;
  let busy = false;

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
      active = false;
      runningSubscriptions = stopSubscriptions(runningSubscriptions);
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
      enqueue(() => {
        busy = false;

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
            vdom = nextVNode;
          }
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

  return managedDispatch;
}

function identityDispatch<State>(dispatch: Dispatch<State>): Dispatch<State> {
  return dispatch;
}

function createVNode<State, Type extends 1 | 3>(
  tag: string,
  props: Props<State>,
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

  if (Array.isArray(value)) {
    return value
      .map(createClass)
      .filter((className) => className.length > 0)
      .join(" ");
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true)
      .map(([className]) => className)
      .join(" ");
  }

  return "";
}

function isArrayOfChildren<State>(
  value: MaybeVNode<State> | ReadonlyArray<MaybeVNode<State>>,
): value is ReadonlyArray<MaybeVNode<State>> {
  return Array.isArray(value);
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

  const keys = new Set([
    ...Object.keys(nextPayload),
    ...Object.keys(oldPayload),
  ]);

  for (const key of keys) {
    const nextValue = nextPayload[key];
    const oldValue = oldPayload[key];

    if (Array.isArray(nextValue) && typeof nextValue[0] === "function") {
      nextPayload[key] = oldValue;
      continue;
    }

    if (typeof nextValue === "function") {
      nextPayload[key] = oldValue;
      continue;
    }

    if (!Object.is(nextValue, oldValue)) {
      return true;
    }
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
  const keys = new Set([...Object.keys(oldStyle), ...Object.keys(newStyle)]);

  for (const key of keys) {
    const value = newStyle[key];
    const nextValue = typeof value === "string" ? value : "";

    if (key.startsWith("-")) {
      style.setProperty(key, nextValue);
      continue;
    }

    style[key] = nextValue;
  }
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
      patchProperty(element, key, undefined, value, listener, nextSvg);
    }

    for (let index = 0; index < vdom.children.length; index += 1) {
      const child = maybeVNode(vdom.children[index]);
      vdom.children[index] = child;
      node.appendChild(createNode(child, listener, nextSvg));
    }
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
  const propKeys = new Set([
    ...Object.keys(oldVNode.props),
    ...Object.keys(newVNode.props),
  ]);

  for (const key of propKeys) {
    const oldValue = oldVNode.props[key];
    const newValue = newVNode.props[key];
    const currentValue =
      key === "value" || key === "selected" || key === "checked"
        ? element[key]
        : oldValue;

    if (!Object.is(currentValue, newValue)) {
      patchProperty(element, key, oldValue, newValue, listener, nextSvg);
    }
  }

  patchChildren(element, oldVNode.children, newVNode.children, listener, nextSvg);
  newVNode.node = node;
  return node;
}

function patchChildren<State>(
  parent: Node,
  oldChildren: Array<MaybeVNode<State>>,
  newChildren: Array<MaybeVNode<State>>,
  listener: EventListener,
  isSvg: boolean,
): void {
  const oldKeyed = new Map<Key, VNode<State>>();
  const oldUnkeyed: Array<VNode<State>> = [];

  for (const child of oldChildren) {
    const oldChild = maybeVNode(child);

    if (oldChild.key === undefined || oldChild.key === null) {
      oldUnkeyed.push(oldChild);
      continue;
    }

    oldKeyed.set(oldChild.key, oldChild);
  }

  const usedOldNodes = new Set<Node>();
  let unkeyedIndex = 0;

  for (let index = 0; index < newChildren.length; index += 1) {
    const newChild = newChildren[index];
    const oldChild = pickOldChild(
      newChild,
      oldKeyed,
      oldUnkeyed,
      unkeyedIndex,
    );

    if (
      oldChild !== undefined &&
      (oldChild.key === undefined || oldChild.key === null)
    ) {
      unkeyedIndex += 1;
    }

    const currentNode = oldChild?.node ?? parent.childNodes[index];
    const normalizedNewChild = maybeVNode(newChild, oldChild);
    const patchedNode = patch(
      parent,
      currentNode ?? parent.appendChild(globalThis.document.createTextNode("")),
      oldChild,
      normalizedNewChild,
      listener,
      isSvg,
    );
    const wantedNode = parent.childNodes.item(index);

    if (wantedNode !== patchedNode) {
      parent.insertBefore(patchedNode, wantedNode);
    }

    usedOldNodes.add(patchedNode);

    if (oldChild?.node !== undefined) {
      usedOldNodes.add(oldChild.node);
    }

    newChildren[index] = normalizedNewChild;
  }

  for (const child of oldChildren) {
    const oldChild = maybeVNode(child);

    if (
      oldChild.node?.parentNode === parent &&
      !usedOldNodes.has(oldChild.node)
    ) {
      parent.removeChild(oldChild.node);
    }
  }
}

function pickOldChild<State>(
  newChild: MaybeVNode<State>,
  keyed: ReadonlyMap<Key, VNode<State>>,
  unkeyed: ReadonlyArray<VNode<State>>,
  unkeyedIndex: number,
): VNode<State> | undefined {
  const key =
    newChild === false || newChild === true || newChild == null
      ? undefined
      : newChild.key;

  if (key !== undefined && key !== null) {
    return keyed.get(key);
  }

  return unkeyed[unkeyedIndex];
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
