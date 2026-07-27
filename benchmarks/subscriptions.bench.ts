import { bench, describe } from "vitest";
import { createStore, signal } from "../src/vanilla";
import { benchmarkOptions } from "./options";

const subscriptionCounts = [1, 100, 1_000, 10_000] as const;

const createSubscriptionFixture = (
  count: number,
  relationship: "related" | "unrelated",
) => {
  const store = createStore();
  const target$ = signal(0);
  let notifications = 0;

  for (let index = 0; index < count; ++index) {
    const subscribed$ =
      relationship === "related" ? target$ : signal(index + 1);
    store.sub(subscribed$, () => {
      ++notifications;
    });
  }

  let next = 1;
  return {
    write() {
      store.set(target$, next);
      next = next === 0 ? 1 : 0;
      return notifications;
    },
  };
};

describe("subscription routing", () => {
  for (const count of subscriptionCounts) {
    const unrelated = createSubscriptionFixture(count, "unrelated");

    bench(
      `write with ${count.toLocaleString("en-US")} unrelated subscribers`,
      () => {
        unrelated.write();
      },
      benchmarkOptions,
    );

    const related = createSubscriptionFixture(count, "related");

    bench(
      `write with ${count.toLocaleString("en-US")} related subscribers`,
      () => {
        related.write();
      },
      benchmarkOptions,
    );
  }
});
