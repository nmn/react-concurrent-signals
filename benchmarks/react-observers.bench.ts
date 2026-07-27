import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { bench, describe } from "vitest";
import {
  Provider,
  createStore,
  signal,
  useObserve,
} from "../src";
import { benchmarkOptions } from "./options";

let rendered = "";

const createTree = (count: number, provider: boolean): ReactNode => {
  const store = createStore();
  const value$ = signal(1);
  const Observer = () => useObserve(() => value$(), { store });
  const children = Array.from({ length: count }, (_, index) =>
    createElement(Observer, { key: index }),
  );
  return provider
    ? createElement(Provider, { store }, children)
    : createElement("div", null, children);
};

describe("React observer counts", () => {
  for (const count of [1, 100, 1_000] as const) {
    const providerTree = createTree(count, true);
    bench(
      `server render ${count.toLocaleString("en-US")} Provider observers`,
      () => {
        rendered = renderToString(providerTree);
      },
      benchmarkOptions,
    );

    const defaultTree = createTree(count, false);
    bench(
      `server render ${count.toLocaleString("en-US")} default observers`,
      () => {
        rendered = renderToString(defaultTree);
      },
      benchmarkOptions,
    );
  }
});

void rendered;
