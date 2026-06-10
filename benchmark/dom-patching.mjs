import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const samples = 9;
const warmupIterations = 100;

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

const suites = [
  stateSuite({
    name: "text update",
    iterations: 3_000,
    initial: { count: 0 },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({ count: index + 1 })),
    view:
      ({ h, text }) =>
      (state) =>
        h("main", {}, text(`Count ${state.count}`)),
  }),
  stateSuite({
    name: "static view rerender",
    iterations: 3_000,
    initial: { count: 0 },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({ count: index + 1 })),
    view:
      ({ h, text }) =>
      () =>
        h("main", {}, [
          h("h1", {}, text("Static")),
          h("p", {}, text("Same virtual shape")),
        ]),
  }),
  stateSuite({
    name: "form props and style",
    iterations: 2_000,
    initial: { value: "value-0", checked: false, hot: false },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        value: `value-${index + 1}`,
        checked: index % 2 === 0,
        hot: index % 3 === 0,
      })),
    view: formView,
  }),
  stateSuite({
    name: "class-heavy form",
    iterations: 2_000,
    initial: { value: "value-0", checked: false, hot: false },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        value: `value-${index + 1}`,
        checked: index % 2 === 0,
        hot: index % 3 === 0,
      })),
    view: classHeavyFormView,
  }),
  stateSuite({
    name: "append and remove keyed rows",
    iterations: 1_200,
    initial: { items: makeItems(40) },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        items: makeItems(index % 2 === 0 ? 41 : 40),
      })),
    view: keyedListView,
  }),
  stateSuite({
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
  }),
  stateSuite({
    name: "reverse keyed rows",
    iterations: 800,
    initial: { items: makeItems(60) },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        items: index % 2 === 0 ? makeItems(60).toReversed() : makeItems(60),
      })),
    view: keyedListView,
  }),
  stateSuite({
    name: "mixed keyed contact rows",
    iterations: 800,
    initial: { contacts: makeContacts(18) },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        contacts:
          index % 2 === 0
            ? makeContacts(18).toReversed()
            : makeContacts(18),
      })),
    view: contactRowsView,
  }),
  stateSuite({
    name: "memo stable child",
    iterations: 2_000,
    initial: { count: 0, label: "fixed" },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        count: index + 1,
        label: "fixed",
      })),
    view:
      ({ h, memo, text }) =>
      (state) =>
        h("main", {}, [
          h("p", {}, text(`Count ${state.count}`)),
          memo(
            (data) =>
              h("section", {}, [
                h("h2", {}, text(data.label)),
                h("p", {}, text("Memoized content")),
              ]),
            { label: state.label },
          ),
        ]),
  }),
  stateSuite({
    name: "ssr recycled rows",
    iterations: 1_200,
    mountHtml: renderServerList(makeItems(40)),
    initial: { items: makeItems(40) },
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        items: makeItems(index % 2 === 0 ? 41 : 40),
      })),
    view: keyedListView,
  }),
  eventSuite({
    name: "button click dispatch",
    iterations: 2_000,
  }),
  subscriptionSuite({
    name: "subscription preserve",
    iterations: 3_000,
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        count: index + 1,
        topic: "same",
      })),
  }),
  subscriptionSuite({
    name: "subscription restart",
    iterations: 1_500,
    states: (count) =>
      Array.from({ length: count }, (_item, index) => ({
        count: index + 1,
        topic: `topic-${index % 2}`,
      })),
  }),
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

function stateSuite(definition) {
  return {
    ...definition,
    run(runtime) {
      const warmupStates = definition.states(warmupIterations);
      const states = definition.states(definition.iterations);
      const dispatch = mountRuntime(runtime, definition);

      for (const state of warmupStates) {
        dispatch(state);
      }

      const started = performance.now();

      for (const state of states) {
        dispatch(state);
      }

      return performance.now() - started;
    },
  };
}

function eventSuite({ name, iterations }) {
  return {
    name,
    iterations,
    run(runtime) {
      const increment = (state) => ({ count: state.count + 1 });
      const dom = installDom("<!doctype html><main id=\"app\"></main>");

      runtime.app({
        init: { count: 0 },
        view: (state) =>
          runtime.h(
            "button",
            { onclick: increment, type: "button" },
            runtime.text(String(state.count)),
          ),
        node: dom.window.document.querySelector("#app"),
      });

      const button = dom.window.document.querySelector("button");
      const event = new dom.window.MouseEvent("click", { bubbles: true });

      for (let index = 0; index < warmupIterations; index += 1) {
        button.dispatchEvent(event);
      }

      const started = performance.now();

      for (let index = 0; index < iterations; index += 1) {
        button.dispatchEvent(event);
      }

      return performance.now() - started;
    },
  };
}

function subscriptionSuite({ name, iterations, states }) {
  return {
    name,
    iterations,
    run(runtime) {
      let starts = 0;
      let stops = 0;
      const subscriber = () => {
        starts += 1;
        return () => {
          stops += 1;
        };
      };
      const dispatch = runtime.app({
        init: { count: 0, topic: "same" },
        subscriptions: (state) => [[subscriber, { topic: state.topic }]],
      });
      const warmupStates = states(warmupIterations);
      const nextStates = states(iterations);

      for (const state of warmupStates) {
        dispatch(state);
      }

      const started = performance.now();

      for (const state of nextStates) {
        dispatch(state);
      }

      if (starts < stops) {
        throw new Error("Subscription benchmark invariant failed");
      }

      return performance.now() - started;
    },
  };
}

function runSuite(runtime, suite) {
  const timings = [];

  for (let sample = 0; sample < samples; sample += 1) {
    timings.push(suite.run(runtime));
  }

  timings.sort((left, right) => left - right);

  const medianMs = timings[Math.floor(timings.length / 2)];

  return {
    medianMs,
    opsPerSecond: suite.iterations / (medianMs / 1_000),
  };
}

function mountRuntime(runtime, suite) {
  const dom = installDom(
    suite.mountHtml ?? "<!doctype html><main id=\"app\"></main>",
  );

  return runtime.app({
    init: suite.initial,
    view: suite.view(runtime),
    node: dom.window.document.querySelector("#app"),
  });
}

function installDom(html) {
  const dom = new JSDOM(html);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  return dom;
}

function formView({ h, text }) {
  return (state) =>
    h("form", {}, [
      h("input", {
        class: ["input", { hot: state.hot }],
        checked: state.checked,
        value: state.value,
      }),
      h(
        "button",
        {
          style: {
            color: state.hot ? "red" : "blue",
            "--accent": state.hot ? "crimson" : "navy",
          },
          type: "button",
        },
        text(state.value),
      ),
    ]);
}

function classHeavyFormView({ h, text }) {
  return (state) =>
    h("form", {}, [
      h("label", { class: "label text-sm font-medium" }, text("Name")),
      h("input", {
        class: [
          "input w-full rounded border px-3 py-2",
          {
            "border-red-500 bg-red-50": state.hot,
            "border-slate-300 bg-white": !state.hot,
            "opacity-80": state.checked,
          },
        ],
        value: state.value,
      }),
      h("p", {
        class: [
          "text-sm",
          {
            "text-red-700": state.hot,
            "text-slate-500": !state.hot,
          },
        ],
      }, text(state.hot ? "Hot" : "Calm")),
    ]);
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

function contactRowsView({ h, text }) {
  return (state) =>
    h(
      "section",
      {},
      state.contacts.map((contact) =>
        h("article", { key: contact.id, class: "grid grid-cols-12 gap-4" }, [
          h("input", { class: "input col-span-3", value: contact.name }),
          h("input", { class: "input col-span-3", value: contact.email }),
          h("input", { class: "input col-span-3", value: contact.phone }),
          h("label", { class: "col-span-3 flex gap-2" }, [
            h("input", { checked: contact.private, type: "checkbox" }),
            h("span", {}, text("Private")),
          ]),
        ]),
      ),
    );
}

function makeItems(count) {
  return Array.from({ length: count }, (_item, index) => `item-${index}`);
}

function makeContacts(count) {
  return Array.from({ length: count }, (_item, index) => ({
    id: `contact-${index}`,
    name: `Contact ${index}`,
    email: `contact-${index}@example.test`,
    phone: `555-010${index}`,
    private: index % 2 === 0,
  }));
}

function renderServerList(items) {
  return `<!doctype html><main id="app"><ol>${items
    .map(
      (item) =>
        `<li data-id="${item}"><span>${item}</span><input value="${item}"></li>`,
    )
    .join("")}</ol></main>`;
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
