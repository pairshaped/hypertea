/** Optional document-state effects. Importing the core Program runtime does not load this module. */
export type ConfirmationValues = ReadonlyArray<Readonly<{ label: string; value: string }>>;
export type PageConfirmation = Readonly<{ token: string; revision: string; summary: string; values: ConfirmationValues }>;
export type PageProjection = Readonly<{
  scope: string;
  pendingNavigation?: string;
  hasUnsavedChanges: boolean;
  protectBeforeUnload: boolean;
  confirmations: ReadonlyArray<PageConfirmation>;
}>;
export type ConfirmationHandle = Readonly<object>;
export type ConfirmationCard = Readonly<{ handle: ConfirmationHandle; summary: string; values: ConfirmationValues }>;
export type PageDecision = PageConfirmation & Readonly<{ scope: string; decision: "confirm" | "cancel" }>;
export type PageState = Readonly<{ pendingNavigation?: string; protectBeforeUnload: boolean; confirmations: ReadonlyArray<ConfirmationCard> }> &
  (Readonly<{ type: "unavailable" }> | Readonly<{ type: "available"; hasUnsavedChanges: boolean }>);
export type PageStateReader = Readonly<{ read: () => PageState; subscribe: (listener: () => void) => () => void }>;
export type PageStateRegistration = Readonly<{ publish: (projection: PageProjection | undefined) => void; dispose: () => void }>;

export const pageStateAvailableEvent = "hypertea:page-state-available";
const readerKey = Symbol.for("hypertea.page-state.reader.v1");
const registryKey = Symbol.for("hypertea.page-state.registry.v1");
type Entry = { readonly live: () => boolean; readonly decide: (decision: PageDecision) => void; projection: PageProjection | undefined; cards: Map<ConfirmationHandle, PageDecision> };
type Registry = { readonly entries: Set<Entry>; readonly listeners: Set<() => void>; readonly reader: PageStateReader; readonly unload: (event: Event) => void; readonly host: Window; guarded: boolean };
type StateDocument = Document & { [readerKey]?: PageStateReader; [registryKey]?: Registry };

/** A shell can discover this port using the versioned document symbol and only a type import. */
export function pageStateReader(page: Document): PageStateReader | undefined {
  return (page as StateDocument)[readerKey];
}

export function sameConfirmation(a: PageConfirmation, b: PageConfirmation): boolean {
  return a.token === b.token && a.revision === b.revision && a.summary === b.summary && a.values.length === b.values.length
    && a.values.every((value, i) => value.label === b.values[i]?.label && value.value === b.values[i].value);
}

/** Called only by a human surface. The target Program still revalidates its current model. */
export function decidePageConfirmation(page: Document, handle: ConfirmationHandle, decision: "confirm" | "cancel"): boolean {
  const registry = (page as StateDocument)[registryKey];
  if (registry === undefined) return false;
  for (const entry of registry.entries) {
    const pending = entry.cards.get(handle);
    if (pending === undefined || !entry.live()) continue;
    entry.cards.delete(handle);
    notify(registry);
    entry.decide({ ...pending, decision });
    return true;
  }
  return false;
}

/** Register in a mount ownership subscription, publish in a separate explicit-payload subscription. */
export function registerPageState(page: Document, live: () => boolean, decide: (decision: PageDecision) => void): PageStateRegistration {
  const host = page.defaultView ?? undefined;
  if (host === undefined) throw new Error("Page state requires a browser window");
  const scope = page as StateDocument;
  let registry = scope[registryKey];
  if (registry === undefined) {
    const entries = new Set<Entry>(), listeners = new Set<() => void>();
    const reader: PageStateReader = Object.freeze({
      read: () => read(entries),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    });
    const unload = (event: Event) => {
      if (!reader.read().protectBeforeUnload) return;
      event.preventDefault();
      // Browser compatibility: native BeforeUnloadEvent uses the empty return value.
      Reflect.set(event, "returnValue", "");
    };
    registry = { entries, listeners, reader, unload, host, guarded: false };
    scope[registryKey] = registry;
    scope[readerKey] = reader;
    page.dispatchEvent(new host.Event(pageStateAvailableEvent));
  }
  const current = registry;
  const entry: Entry = { live, decide, projection: undefined, cards: new Map() };
  current.entries.add(entry);
  notify(current);
  return {
    publish: (projection) => {
      if (!current.entries.has(entry) || !entry.live()) return;
      const cards = new Map<ConfirmationHandle, PageDecision>();
      if (projection !== undefined) {
        for (const pending of projection.confirmations) {
          const prior = [...entry.cards].find(([, candidate]) => candidate.scope === projection.scope && sameConfirmation(candidate, pending));
          const handle = prior?.[0] ?? Object.freeze({});
          const values = Object.freeze(pending.values.map(value => Object.freeze({ ...value })));
          cards.set(handle, Object.freeze({ token: pending.token, revision: pending.revision, summary: pending.summary, values, scope: projection.scope, decision: "confirm" }));
        }
        entry.projection = Object.freeze({ scope: projection.scope, ...(projection.pendingNavigation === undefined ? {} : {pendingNavigation: projection.pendingNavigation}), hasUnsavedChanges: projection.hasUnsavedChanges, protectBeforeUnload: projection.protectBeforeUnload, confirmations: Object.freeze([...cards.values()]) });
      } else entry.projection = undefined;
      entry.cards = cards;
      notify(current);
    },
    dispose: () => {
      if (!current.entries.delete(entry)) return;
      entry.cards.clear();
      notify(current);
    },
  };
}

function read(entries: Set<Entry>): PageState {
  const live = [...entries].filter(entry => entry.live());
  const confirmations = Object.freeze(live.flatMap(entry => [...entry.cards].map(([handle, pending]) => Object.freeze({ handle, summary: pending.summary, values: pending.values }))));
  const pendingNavigation = live.map(entry => entry.projection?.pendingNavigation).find(target => target !== undefined);
  const navigation = pendingNavigation === undefined ? {} : {pendingNavigation};
  const protectBeforeUnload = live.some(entry => entry.projection?.protectBeforeUnload === true);
  return Object.freeze(live.length === 0 || live.some(entry => entry.projection === undefined)
    ? { type: "unavailable", ...navigation, protectBeforeUnload, confirmations }
    : { type: "available", ...navigation, protectBeforeUnload, confirmations, hasUnsavedChanges: live.some(entry => entry.projection?.hasUnsavedChanges === true) });
}

function notify(registry: Registry): void {
  const protect = registry.reader.read().protectBeforeUnload;
  if (protect !== registry.guarded) {
    registry.guarded = protect;
    if (protect) registry.host.addEventListener("beforeunload", registry.unload);
    else registry.host.removeEventListener("beforeunload", registry.unload);
  }
  for (const listener of registry.listeners) listener();
}
