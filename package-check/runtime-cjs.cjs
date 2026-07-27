"use strict";

const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const root = require("react-concurrent-signals");
const react = require("react-concurrent-signals/react");
const {
  createStore,
  signal,
} = require("react-concurrent-signals/vanilla");

const main = async () => {
  assert.equal(typeof root.signal, "function");
  assert.equal(typeof react.useObserve, "function");

  const count$ = signal(1);
  const doubled$ = signal(() => count$() * 2);
  const store = createStore();

  assert.equal(store.get(doubled$), 2);
  store.set(count$, 2);
  assert.equal(store.get(doubled$), 4);

  const effectValue$ = signal(0);
  const effectStore = createStore();
  let effectRuns = 0;
  const stopEffect = effectStore.run(() =>
    root.effect(
      () => effectValue$(),
      () => {
        ++effectRuns;
      },
    ),
  );
  assert.equal(effectRuns, 1);
  effectStore.set(effectValue$, 1);
  assert.equal(effectRuns, 2);
  stopEffect();

  const dom = new JSDOM("<div id=\"root\"></div>", {
    url: "http://localhost",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const observed$ = signal(0);
  const observedStore = createStore();
  observedStore.set(observed$, 5);

  const ContextObserver = () =>
    React.createElement(
      "span",
      { id: "context-value" },
      react.useObserve(() => observed$()),
    );
  const ExplicitObserver = () =>
    React.createElement(
      "span",
      { id: "explicit-value" },
      react.useObserve(() => observed$(), { store: observedStore }),
    );
  const container = document.getElementById("root");
  assert.ok(container);
  const reactRoot = createRoot(container);

  await React.act(async () => {
    reactRoot.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          react.Provider,
          { store: observedStore },
          React.createElement(ContextObserver),
        ),
        React.createElement(ExplicitObserver),
      ),
    );
  });
  assert.equal(document.getElementById("context-value")?.textContent, "5");
  assert.equal(document.getElementById("explicit-value")?.textContent, "5");

  await React.act(async () => {
    observedStore.set(observed$, 6);
  });
  assert.equal(document.getElementById("context-value")?.textContent, "6");
  assert.equal(document.getElementById("explicit-value")?.textContent, "6");

  let resolveTransition;
  await React.act(async () => {
    React.startTransition(async () => {
      observedStore.set(observed$, (value) => value + 1);
      await new Promise((resolve) => {
        resolveTransition = resolve;
      });
    });
  });
  assert.equal(document.getElementById("context-value")?.textContent, "6");
  assert.equal(document.getElementById("explicit-value")?.textContent, "6");

  await React.act(async () => {
    observedStore.set(observed$, (value) => value + 10);
  });
  assert.equal(document.getElementById("context-value")?.textContent, "16");
  assert.equal(document.getElementById("explicit-value")?.textContent, "16");

  await React.act(async () => {
    resolveTransition();
  });
  assert.equal(document.getElementById("context-value")?.textContent, "17");
  assert.equal(document.getElementById("explicit-value")?.textContent, "17");

  await React.act(async () => {
    reactRoot.unmount();
  });
  assert.equal(observedStore.concurrentStore.listenerCount(), 0);
  dom.window.close();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
