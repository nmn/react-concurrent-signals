import { bench, describe } from "vitest";
import { createStore, effect, signal } from "../src/vanilla";
import { benchmarkOptions } from "./options";

let creationResult: unknown;

describe("creation and mount churn", () => {
  const source$ = signal(0);

  bench(
    "create primitive signal",
    () => {
      creationResult = signal(0);
    },
    benchmarkOptions,
  );

  bench(
    "create computed signal",
    () => {
      creationResult = signal(() => source$());
    },
    benchmarkOptions,
  );
  bench(
    "create store",
    () => {
      creationResult = createStore();
    },
    benchmarkOptions,
  );

  const store = createStore();
  const mounted$ = signal(0);
  mounted$.onMount = () => () => undefined;

  for (const count of [100, 1_000] as const) {
    bench(
      `subscribe and unsubscribe ${count.toLocaleString("en-US")} mounted primitives`,
      () => {
        const cleanups: (() => void)[] = [];
        for (let index = 0; index < count; ++index) {
          cleanups.push(store.sub(mounted$, () => undefined));
        }
        for (let index = cleanups.length - 1; index >= 0; --index) {
          cleanups[index]();
        }
      },
      benchmarkOptions,
    );
  }

  bench(
    "subscribe and unsubscribe mounted primitive",
    () => store.sub(mounted$, () => undefined)(),
    benchmarkOptions,
  );

  bench(
    "subscribe and unsubscribe effect",
    () =>
      store.run(() =>
        effect(
          () => mounted$(),
          () => undefined,
        ),
      )(),
    benchmarkOptions,
  );
});

describe("effect notification", () => {
  for (const count of [1, 100, 1_000] as const) {
    const store = createStore();
    const source$ = signal(0);
    let effectRuns = 0;

    for (let index = 0; index < count; ++index) {
      store.run(() =>
        effect(
          () => source$(),
          () => {
            ++effectRuns;
          },
        ),
      );
    }

    let next = 1;
    bench(
      `write with ${count.toLocaleString("en-US")} effects`,
      () => {
        store.set(source$, next);
        next = next === 0 ? 1 : 0;
        creationResult = effectRuns;
      },
      benchmarkOptions,
    );
  }
});

void creationResult;
