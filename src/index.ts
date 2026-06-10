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
  const nextProps: Record<string, unknown> = {};

  for (const name in props) {
    if (name !== "key" && name !== "class") {
      nextProps[name] = props[name];
    }
  }

  const className = createClass(classValue);

  if (className.length > 0) {
    nextProps.class = className;
  }

  return createVNode(
    tag,
    nextProps as Props<State>,
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

function isClassArray(value: ClassProp): value is ReadonlyArray<ClassProp> {
  return Array.isArray(value);
}

function isClassRecord(
  value: ClassProp,
): value is Readonly<Record<string, boolean | undefined | null>> {
  return value !== null && typeof value === "object" && !isClassArray(value);
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

  for (const key in oldVNode.props) {
    const oldValue = oldVNode.props[key];
    const newValue = newVNode.props[key];
    patchChangedProperty(element, key, oldValue, newValue, listener, nextSvg);
  }

  for (const key in newVNode.props) {
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
  newVNode.node = node;
  return node;
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
  const oldUnkeyed: Array<VNode<State>> = [];

  for (let index = oldHead; index <= oldTail; index += 1) {
    const oldChild = maybeVNode(oldChildren[index]);
    oldChildren[index] = oldChild;

    if (oldChild.key === undefined || oldChild.key === null) {
      oldUnkeyed.push(oldChild);
      continue;
    }

    oldKeyed.set(oldChild.key, oldChild);
  }

  const usedOldNodes = new Set<Node>();
  let unkeyedIndex = 0;

  for (let index = newHead; index <= newTail; index += 1) {
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

  for (let index = oldHead; index <= oldTail; index += 1) {
    const oldChild = maybeVNode(oldChildren[index]);

    if (
      oldChild.node?.parentNode === parent &&
      !usedOldNodes.has(oldChild.node)
    ) {
      parent.removeChild(oldChild.node);
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
