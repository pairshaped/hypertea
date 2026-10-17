import { afterEach, expect, test, vi } from "vitest";
import { decidePageConfirmation, pageStateReader, registerPageState, type PageProjection } from "./page-state.js";

const clean: PageProjection = { scope: "record:1", hasUnsavedChanges: false, protectBeforeUnload: false, confirmations: [] };
const proposal = { token: "1", revision: "amount:0", summary: "Delete zero", values: [{ label: "Amount", value: "0" }] };
const owners: Array<{ dispose: () => void }> = [];
function owner(page = document, live = () => true) {
  const decide = vi.fn();
  const registration = registerPageState(page, live, decide);
  owners.push(registration);
  return { ...registration, decide };
}
afterEach(() => { owners.splice(0).forEach(x => { x.dispose(); }); vi.restoreAllMocks(); });

test("document reader is unavailable before publication and unprojected owners never report clean", () => {
  expect(pageStateReader(document)).toBeUndefined();
  const a = owner();
  const reader = pageStateReader(document);
  expect(reader).toBeDefined();
  expect(reader?.read().type).toBe("unavailable");
  a.publish(clean);
  expect(reader?.read()).toMatchObject({ type: "available", hasUnsavedChanges: false });
  const b = owner();
  expect(reader?.read().type).toBe("unavailable");
  b.dispose();
  expect(reader?.read().type).toBe("available");
  a.publish(undefined);
  expect(reader?.read().type).toBe("unavailable");
});

test("one document guard aggregates current protection and removes only its final owner", () => {
  const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
  const a = owner(), b = owner();
  a.publish(clean); b.publish(clean);
  expect(add.mock.calls.filter(x => x[0] === "beforeunload")).toHaveLength(0);
  a.publish({ ...clean, hasUnsavedChanges: true, protectBeforeUnload: true }); b.publish({ ...clean, protectBeforeUnload: true });
  expect(add.mock.calls.filter(x => x[0] === "beforeunload")).toHaveLength(1);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  a.dispose();
  expect(pageStateReader(document)?.read()).toMatchObject({ type: "available", hasUnsavedChanges: false });
  expect(remove.mock.calls.filter(x => x[0] === "beforeunload")).toHaveLength(0);
  b.publish(clean);
  expect(remove.mock.calls.filter(x => x[0] === "beforeunload")).toHaveLength(1);
  const cleanEvent = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(cleanEvent);
  expect(cleanEvent.defaultPrevented).toBe(false);
  b.publish({ ...clean, protectBeforeUnload: true });
  expect(pageStateReader(document)?.read()).toMatchObject({ type: "available", hasUnsavedChanges: false, protectBeforeUnload: true });
  expect(add.mock.calls.filter(x => x[0] === "beforeunload")).toHaveLength(2);
  b.dispose(); b.dispose();
  expect(remove.mock.calls.filter(x => x[0] === "beforeunload")).toHaveLength(2);
});

test("cards are immutable, mount scoped, consumed once and invalidated by material/scope/cycle changes", () => {
  const a = owner(), b = owner();
  a.publish({ ...clean, confirmations: [proposal] }); b.publish({ ...clean, confirmations: [proposal] });
  const reader = pageStateReader(document); if (reader === undefined) throw new Error("Missing reader");
  const [first, second] = reader.read().confirmations; if (first === undefined || second === undefined) throw new Error("Missing cards");
  expect(first.handle).not.toBe(second.handle);
  a.publish({ ...clean, confirmations: [{ ...proposal }] });
  expect(reader.read().confirmations[0]?.handle).toBe(first.handle);
  expect(Object.isFrozen(first.values[0])).toBe(true);
  expect(decidePageConfirmation(document, first.handle, "confirm")).toBe(true);
  expect(a.decide).toHaveBeenCalledWith(expect.objectContaining({ token: "1", decision: "confirm" }));
  expect(b.decide).not.toHaveBeenCalled();
  expect(decidePageConfirmation(document, first.handle, "cancel")).toBe(false);
  a.publish({ ...clean, confirmations: [proposal] });
  const reopened = reader.read().confirmations[0]; if (reopened === undefined) throw new Error("Missing reopened card");
  a.publish({ ...clean, confirmations: [{ ...proposal, values: [{ label: "Amount", value: "9" }] }] });
  expect(decidePageConfirmation(document, reopened.handle, "confirm")).toBe(false);
  const changed = reader.read().confirmations[0]; if (changed === undefined) throw new Error("Missing changed card");
  a.publish({ ...clean, scope: "record:2", confirmations: [proposal] });
  expect(decidePageConfirmation(document, changed.handle, "confirm")).toBe(false);
  a.publish({ ...clean, confirmations: [{ ...proposal, revision: "new" }] });
  a.publish({ ...clean, confirmations: [{ ...proposal, token: "2", summary: "Other", values: [] }] });
  a.publish(clean);
  expect(reader.read().confirmations).toHaveLength(1);
});

test("disconnected or disposed owners cannot warn, dispatch or republish; retained readers follow replacement", () => {
  let connected = true;
  const a = owner(document, () => connected);
  a.publish({ ...clean, protectBeforeUnload: true, confirmations: [proposal] });
  const reader = pageStateReader(document); if (reader === undefined) throw new Error("Missing reader");
  const card = reader.read().confirmations[0]; if (card === undefined) throw new Error("Missing card");
  connected = false;
  expect(reader.read().type).toBe("unavailable");
  expect(decidePageConfirmation(document, card.handle, "cancel")).toBe(false);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  a.dispose(); a.publish(clean);
  const b = owner(); b.publish(clean);
  a.dispose();
  expect(reader.read().type).toBe("available");
});

test("read subscribers see publication and teardown, can detach and discover across module instances", async () => {
  const a = owner(); const reader = pageStateReader(document); if (reader === undefined) throw new Error("Missing reader");
  const listener = vi.fn(); const unsubscribe = reader.subscribe(listener);
  a.publish(clean); expect(listener).toHaveBeenCalledTimes(1);
  vi.resetModules(); const independent = await import("./page-state.js");
  expect(independent.pageStateReader(document)).toBe(reader);
  const b = independent.registerPageState(document, () => true, () => { /* No pending decision in this owner. */ }); owners.push(b);
  b.publish(clean); a.dispose();
  expect(reader.read().type).toBe("available");
  unsubscribe(); const count = listener.mock.calls.length; b.dispose();
  expect(listener).toHaveBeenCalledTimes(count);
  expect(reader.read().type).toBe("unavailable");
  expect(independent.decidePageConfirmation(document, {}, "confirm")).toBe(false);
});

test("another document is isolated and a document without a window refuses registration", () => {
  const detached = document.implementation.createHTMLDocument();
  expect(() => registerPageState(detached, () => true, () => { /* No pending decision in this owner. */ })).toThrow("browser window");
  expect(decidePageConfirmation(detached, {}, "cancel")).toBe(false);
});


test("independent browser documents keep readers, handles and guards isolated", () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const other = frame.contentDocument; if (other === null) throw new Error("Missing iframe document");
  const a = owner(), b = owner(other);
  a.publish({ ...clean, protectBeforeUnload: true, confirmations: [proposal] }); b.publish(clean);
  expect(pageStateReader(document)).not.toBe(pageStateReader(other));
  expect(pageStateReader(other)?.read()).toMatchObject({ type: "available", protectBeforeUnload: false });
  const card = pageStateReader(document)?.read().confirmations[0]; if (card === undefined) throw new Error("Missing first-document card");
  expect(decidePageConfirmation(other, card.handle, "confirm")).toBe(false);
  frame.remove();
});


test("every declared confirmation identity or material delta invalidates its old handle", () => {
  const a = owner(); const reader = pageStateReader(document); if (reader === undefined) throw new Error("Missing reader");
  for (const changed of [{ ...proposal, token: "other" }, { ...proposal, revision: "other" }, { ...proposal, summary: "other" },
    { ...proposal, values: [] }, { ...proposal, values: [{ label: "Other label", value: "0" }] }]) {
    a.publish({ ...clean, confirmations: [proposal] });
    const original = reader.read().confirmations[0]; if (original === undefined) throw new Error("Missing original card");
    a.publish({ ...clean, confirmations: [changed] });
    expect(decidePageConfirmation(document, original.handle, "confirm")).toBe(false);
  }
  a.publish({ ...clean, confirmations: [proposal] });
  const last = reader.read().confirmations[0]; if (last === undefined) throw new Error("Missing last card");
  a.dispose(); const replacement = owner(); replacement.publish({ ...clean, confirmations: [proposal] });
  expect(decidePageConfirmation(document, last.handle, "confirm")).toBe(false);
  expect(a.decide).not.toHaveBeenCalled(); expect(replacement.decide).not.toHaveBeenCalled();
});


test("pending navigation is a read-only projection and clears when the page chooses Stay", () => {
  const a = owner(), b = owner();
  a.publish({...clean,pendingNavigation:"/website/sponsors"});
  expect(pageStateReader(document)?.read()).toMatchObject({pendingNavigation:"/website/sponsors"});
  b.publish({...clean,pendingNavigation:"/settings/tags"});
  a.publish(clean);
  expect(pageStateReader(document)?.read()).toMatchObject({pendingNavigation:"/settings/tags"});
  b.publish(clean);
  expect(pageStateReader(document)?.read()).not.toHaveProperty("pendingNavigation");
  expect(a.decide).not.toHaveBeenCalled();expect(b.decide).not.toHaveBeenCalled();
});
