import { bench, describe } from "vitest";
import { createStore, signal } from "../src/vanilla";
import { benchmarkOptions } from "./options";

let readResult: unknown;

describe("signal reads and unchanged computed outputs", () => {
  const store = createStore();
  const source$ = signal(1);
  const doubled$ = signal(() => source$() * 2);
  store.get(doubled$);

  bench(
    "cached primitive read",
    () => {
      readResult = store.get(source$);
    },
    benchmarkOptions,
  );

  bench(
    "cached computed read",
    () => {
      readResult = store.get(doubled$);
    },
    benchmarkOptions,
  );

  let coldValue = 0;
  bench(
    "cold primitive store read",
    () => {
      const coldStore = createStore();
      const cold$ = signal(++coldValue);
      readResult = coldStore.get(cold$);
    },
    benchmarkOptions,
  );

  bench(
    "cold computed store read",
    () => {
      const coldStore = createStore();
      const cold$ = signal(++coldValue);
      const computed$ = signal(() => cold$() * 2);
      readResult = coldStore.get(computed$);
    },
    benchmarkOptions,
  );

  const unchangedStore = createStore();
  const changing$ = signal(1);
  const unchanged$ = signal(() => changing$() > 0);
  unchangedStore.get(unchanged$);
  let next = 2;

  bench(
    "invalidated computed with unchanged output",
    () => {
      unchangedStore.set(changing$, next);
      next = next === 1 ? 2 : 1;
      readResult = unchangedStore.get(unchanged$);
    },
    benchmarkOptions,
  );
});

void readResult;
