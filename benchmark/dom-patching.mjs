import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const samples = 9;
const warmupIterations = 100;

const suites = [
  {
    name: "text update",
    iterations: 3_000,
    initial: { count: 0 },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({ count: index + 1 })),
    view:
      ({ h, text }) =>
      (state) =>
        h("main", {}, text(`Count ${state.count}`)),
  },
  {
    name: "form props and style",
    iterations: 2_000,
    initial: { value: "value-0", checked: false, hot: false },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        value: `value-${index + 1}`,
        checked: index % 2 === 0,
        hot: index % 3 === 0,
      })),
    view:
      ({ h, text }) =>
      (state) =>
        h("form", {}, [
          h("input", {
            class: ["input", { hot: state.hot }],
            checked: state.checked,
            value: state.value,
          }),
          h("button", {
            style: {
              color: state.hot ? "red" : "blue",
              "--accent": state.hot ? "crimson" : "navy",
            },
            type: "button",
          }, text(state.value)),
        ]),
  },
  {
    name: "append and remove keyed rows",
    iterations: 1_200,
    initial: { items: makeItems(40) },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        items: makeItems(index % 2 === 0 ? 41 : 40),
      })),
    view: keyedListView,
  },
  {
    name: "move keyed middle rows",
    iterations: 1_200,
    initial: { items: ["head", ...makeItems(24), "tail"] },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        items:
          index % 2 === 0
            ? ["head", ...makeItems(24).toReversed(), "tail"]
            : ["head", ...makeItems(24), "tail"],
      })),
    view: keyedListView,
  },
  {
    name: "reverse keyed rows",
    iterations: 800,
    initial: { items: makeItems(60) },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        items: index % 2 === 0 ? makeItems(60).toReversed() : makeItems(60),
      })),
    view: keyedListView,
  },
];

globalThis.requestAnimationFrame = (callback) => {
  callback(performance.now());
  return 0;
};
globalThis.cancelAnimationFrame = () => undefined;

const hyperapp = await import("hyperapp");
const hypertea = await import("../dist/index.js");

const adapters = [
  {
    name: "hyperapp",
    runtime: hyperapp,
  },
  {
    name: "hypertea",
    runtime: hypertea,
  },
];

const results = [];

for (const suite of suites) {
  const row = { scenario: suite.name };

  for (const adapter of adapters) {
    row[adapter.name] = runSuite(adapter.runtime, suite);
  }

  results.push(row);
}

printResults(results);

function runSuite(runtime, suite) {
  const warmupStates = suite.states(warmupIterations);
  const states = suite.states(suite.iterations);
  const timings = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const dispatch = mountRuntime(runtime, suite);

    for (const state of warmupStates) {
      dispatch(state);
    }

    const started = performance.now();

    for (const state of states) {
      dispatch(state);
    }

    timings.push(performance.now() - started);
  }

  timings.sort((left, right) => left - right);

  const medianMs = timings[Math.floor(timings.length / 2)];

  return {
    medianMs,
    opsPerSecond: suite.iterations / (medianMs / 1_000),
  };
}

function mountRuntime(runtime, suite) {
  const dom = new JSDOM("<!doctype html><main id=\"app\"></main>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  return runtime.app({
    init: suite.initial,
    view: suite.view(runtime),
    node: dom.window.document.querySelector("#app"),
  });
}

function keyedListView({ h, text }) {
  return (state) =>
    h(
      "ol",
      {},
      state.items.map((item) =>
        h("li", { key: item, "data-id": item }, [
          h("span", {}, text(item)),
          h("input", { value: item }),
        ]),
      ),
    );
}

function makeItems(count) {
  return Array.from({ length: count }, (_item, index) => `item-${index}`);
}

function printResults(rows) {
  const printable = rows.map((row) => {
    const hyperappResult = row.hyperapp;
    const hyperteaResult = row.hypertea;
    const relative = hyperteaResult.medianMs / hyperappResult.medianMs;

    return {
      scenario: row.scenario,
      "hyperapp ms": formatNumber(hyperappResult.medianMs),
      "hypertea ms": formatNumber(hyperteaResult.medianMs),
      "hyperapp ops/s": formatNumber(hyperappResult.opsPerSecond),
      "hypertea ops/s": formatNumber(hyperteaResult.opsPerSecond),
      "tea/app": `${formatNumber(relative)}x`,
    };
  });

  console.table(printable);
  console.log(
    "Median of",
    samples,
    "samples. Lower ms is better. jsdom results are for regression tracking, not browser parity claims.",
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}
