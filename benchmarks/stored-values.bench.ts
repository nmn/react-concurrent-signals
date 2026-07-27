import { bench, describe } from "vitest";
import { createStore, signal, type WritableSignal } from "../src/vanilla";
import { benchmarkOptions } from "./options";

const storedValueCounts = [1, 100, 1_000, 10_000] as const;

const createPopulatedStore = (count: number) => {
  const store = createStore();
  const signals: WritableSignal<number>[] = [];

  for (let index = 0; index < count; ++index) {
    signals.push(signal(0));
  }

  // Populate one immutable snapshot in a single derived write. Repeated public
  // Store.set calls here would make fixture construction itself O(count²) on
  // implementations that copy the entire value map.
  const populate$ = signal(
    () => undefined,
    () => {
      for (let index = 0; index < signals.length; ++index) {
        signals[index]!.set(index + 1);
      }
    },
  );
  store.set(populate$);

  return { store, target$: signals[0]! };
};

describe("stored value scaling", () => {
  for (const count of storedValueCounts) {
    const changed = createPopulatedStore(count);
    let next = 0;

    bench(
      `changed write with ${count.toLocaleString("en-US")} stored values`,
      () => {
        changed.store.set(changed.target$, next);
        next = next === 0 ? 1 : 0;
      },
      benchmarkOptions,
    );

    const unchanged = createPopulatedStore(count);

    bench(
      `no-op write with ${count.toLocaleString("en-US")} stored values`,
      () => {
        unchanged.store.set(unchanged.target$, 1);
      },
      benchmarkOptions,
    );
  }
});
