import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { checkFragmentRoots } from "./check-fragment-roots.mjs";

function check(source) {
  const options = { jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "fragment", noLib: true };
  const files = {
    "/fixture.tsx": source,
    "/helper.tsx": 'export const result = () => <>helper</>;',
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => files[name] === undefined ? undefined : ts.createSourceFile(name, files[name], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  host.fileExists = name => Object.hasOwn(files, name);
  host.readFile = name => files[name];
  host.directoryExists = () => true;
  return checkFragmentRoots(ts.createProgram(["/fixture.tsx"], options, host));
}

for (const [name, source] of [
  ["initial root", 'const program = { init: () => undefined, view: () => <>initial</> };'],
  ["conditional insertion", 'const program = { init: () => undefined, view: (shown: boolean) => shown ? <>inserted</> : <main/> };'],
  ["update", 'const view = (value: string) => <>{value}</>; const program = { init: () => undefined, view };'],
  ["removal", 'const program = { init: () => undefined, view(shown: boolean) { if (!shown) return <main/>; return <>remove</>; } };'],
  ["helper", 'const helper = () => <>bad</>; const program = { init: () => undefined, view: () => helper() };'],
  ["imported helper", 'import { result as helper } from "./helper"; const program = { init: () => undefined, view: helper };'],
  ["forwarded fragment", 'const identity = value => value; const program = { init: () => undefined, view: () => identity(<>bad</>) };'],
  ["quoted property", 'const program = { init: () => undefined, "view": () => <>bad</> };'],
  ["default argument", 'const helper = (value = <>bad</>) => value; const program = { init: () => undefined, view: () => helper() };'],
  ["local expression", 'const program = { init: () => undefined, view: () => { const result = <>bad</>; return result; } };'],
]) {
  test(`rejects ${name} before mounting`, () => {
    const errors = check(source);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Hypertea views require one root VNode/);
  });
}

test("allows child fragments, including helpers and nested fragments", () => {
  assert.deepEqual(check('const helper = () => <><b/></>; const program = { init: () => undefined, view: (shown: boolean) => <main>{shown ? <>{helper()}<><i/></></> : undefined}</main> };'), []);
});

test("follows cycles without looping and deduplicates shared root failures", () => {
  assert.deepEqual(check('const helper = () => helper(); const program = { init: () => undefined, view: helper };'), []);
  assert.equal(check('const helper = () => <>bad</>; const a = { init: () => undefined, view: helper }; const b = { init: () => undefined, view: helper };').length, 1);
});

test("a fragment used only as a condition cannot become the root", () => {
  assert.deepEqual(check('const condition = <>child</>; const program = { init: () => undefined, view: () => condition && <main/> };'), []);
});

test("a child helper named view remains valid outside a Program", () => {
  assert.deepEqual(check('const child = { view: () => <>child</> }; const program = { init: () => undefined, view: () => <main>{child.view()}</main> };'), []);
});
