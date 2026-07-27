import { startTransition } from "react";
import { describe, expect, it } from "vitest";
import { createStore, effect, signal } from "../src/vanilla";

describe("subscription dependency tracking", () => {
  it("refreshes dynamic dependencies when a branch switch has an equal result", () => {
    const useRight$ = signal(false);
    const left$ = signal(1);
    const right$ = signal(1);
    const selected$ = signal(() => (useRight$() ? right$() : left$()));
    const store = createStore();
    const values: number[] = [];

    const unsubscribe = store.sub(selected$, () => {
      values.push(store.get(selected$));
    });

    store.run(() => useRight$.set(true));
    expect(values).toEqual([]);

    store.run(() => right$.set(2));
    expect(values).toEqual([2]);

    store.run(() => left$.set(3));
    expect(values).toEqual([2]);

    unsubscribe();
  });
});

describe("head and committed subscription baselines", () => {
  it("notifies when a transition reverts the latest synchronous value", () => {
    const count$ = signal(0);
    const store = createStore();
    const values: number[] = [];

    const unsubscribe = store.sub(count$, () => {
      values.push(store.get(count$));
    });

    store.run(() => count$.set(1));
    startTransition(() => {
      store.run(() => count$.set(0));
    });

    expect(values).toEqual([1, 0]);
    unsubscribe();
  });

  it("notifies when a synchronous write reverts a committed transition", () => {
    const count$ = signal(0);
    const store = createStore();
    const values: number[] = [];

    const unsubscribe = store.sub(count$, () => {
      values.push(store.get(count$));
    });

    startTransition(() => {
      store.run(() => count$.set(1));
    });
    store.concurrentStore.commit(store.getSnapshot());
    store.run(() => count$.set(0));

    expect(values).toEqual([1, 0]);
    unsubscribe();
  });
});

describe("reentrant notifications", () => {
  it("compares every nested write against that write's exact snapshots", () => {
    const left$ = signal(0);
    const right$ = signal(0);
    const total$ = signal(() => left$() + right$());
    const store = createStore();
    let totalNotifications = 0;

    const stopWriter = store.run(() =>
      effect(
        () => left$(),
        () => {
          if (left$() > 0) {
            right$.set(left$());
          }
        },
      ),
    );
    const stopTotal = store.sub(total$, () => {
      ++totalNotifications;
    });

    store.run(() => left$.set(1));

    // The nested right$ write is delivered depth-first (total 1 -> 2), then
    // notification of the outer left$ write resumes (total 0 -> 1).
    expect(totalNotifications).toBe(2);
    expect(store.get(total$)).toBe(2);

    stopTotal();
    stopWriter();
  });
});

describe("transactional writable signals", () => {
  it("returns the writer result and lets later writes read earlier draft writes", () => {
    const left$ = signal(1);
    const right$ = signal(2);
    const receipt = { committed: true };
    const updateBoth$ = signal(
      () => left$() + right$(),
      (amount: number) => {
        left$.set(left$() + amount);
        right$.set(left$() * 2);
        return receipt;
      },
    );
    const store = createStore();

    const result = store.run(() => updateBoth$.set(3));

    expect(result).toBe(receipt);
    expect(store.get(left$)).toBe(4);
    expect(store.get(right$)).toBe(8);
  });

  it("rolls back every draft write when a writer throws", () => {
    const left$ = signal(1);
    const right$ = signal(2);
    const failure = new Error("abort transaction");
    const failingWrite$ = signal(
      () => null,
      () => {
        left$.set(10);
        right$.set(20);
        throw failure;
      },
    );
    const store = createStore();
    let notifications = 0;
    const stopLeft = store.sub(left$, () => {
      ++notifications;
    });
    const stopRight = store.sub(right$, () => {
      ++notifications;
    });

    expect(() => store.run(() => failingWrite$.set())).toThrow(failure);
    expect(store.get(left$)).toBe(1);
    expect(store.get(right$)).toBe(2);
    expect(notifications).toBe(0);

    stopRight();
    stopLeft();
  });
});

describe("Object.is result semantics", () => {
  it("treats NaN as unchanged and distinguishes positive and negative zero", () => {
    const nan$ = signal(Number.NaN);
    const zero$ = signal(0);
    const store = createStore();
    let nanNotifications = 0;
    let zeroNotifications = 0;
    const stopNan = store.sub(nan$, () => {
      ++nanNotifications;
    });
    const stopZero = store.sub(zero$, () => {
      ++zeroNotifications;
    });

    store.run(() => nan$.set(Number.NaN));
    store.run(() => zero$.set(-0));

    expect(nanNotifications).toBe(0);
    expect(zeroNotifications).toBe(1);
    expect(Object.is(store.get(zero$), -0)).toBe(true);

    stopZero();
    stopNan();
  });
});

describe("snapshot compatibility", () => {
  it("preserves first-write insertion order in the lazy values view", () => {
    const first$ = signal(0);
    const second$ = signal(0);
    const store = createStore();

    store.run(() => second$.set(2));
    store.run(() => first$.set(1));
    store.run(() => second$.set(3));

    const snapshot = store.getSnapshot();
    expect(Array.from(snapshot.values)).toEqual([
      [second$, 3],
      [first$, 1],
    ]);
    expect(snapshot.values).toBe(snapshot.values);
  });

  it("honors a pre-seeded public cache entry", () => {
    const count$ = signal(1);
    const doubled$ = signal(() => count$() * 2);
    const store = createStore();
    const snapshot = store.getSnapshot();

    snapshot.cache.set(doubled$, { type: "value", value: 99 });

    expect(store.getFromSnapshot(doubled$, snapshot)).toBe(99);
  });
});

describe("notification iteration", () => {
  it("uses a stable listener snapshot when listeners mutate membership", () => {
    const count$ = signal(0);
    const store = createStore();
    const events: string[] = [];
    let stopSecond = () => {};
    let stopThird = () => {};
    let addedThird = false;

    const stopFirst = store.sub(count$, () => {
      events.push(`first:${store.get(count$)}`);
      if (!addedThird) {
        addedThird = true;
        stopSecond();
        stopThird = store.sub(count$, () => {
          events.push(`third:${store.get(count$)}`);
        });
      }
    });
    stopSecond = store.sub(count$, () => {
      events.push(`second:${store.get(count$)}`);
    });

    store.run(() => count$.set(1));
    expect(events).toEqual(["first:1", "second:1"]);

    events.length = 0;
    store.run(() => count$.set(2));
    expect(events).toEqual(["first:2", "third:2"]);

    stopThird();
    stopSecond();
    stopFirst();
  });

  it("interleaves phase and signal listeners in registration order", () => {
    const count$ = signal(0);
    const store = createStore();
    const events: string[] = [];
    const stopFirst = store.concurrentStore.subscribe(() => {
      events.push("phase:first");
    });
    const stopSignal = store.sub(count$, () => {
      events.push("signal");
    });
    const stopLast = store.concurrentStore.subscribe(() => {
      events.push("phase:last");
    });

    expect(store.concurrentStore.listenerCount()).toBe(3);
    store.run(() => count$.set(1));
    expect(events).toEqual(["phase:first", "signal", "phase:last"]);

    stopLast();
    stopSignal();
    stopFirst();
    expect(store.concurrentStore.listenerCount()).toBe(0);
  });
});

describe("mount-time writes", () => {
  it("does not notify a subscriber before registration completes", () => {
    const count$ = signal(0);
    const store = createStore();
    let notifications = 0;
    count$.onMount = (setCount) => {
      setCount(1);
    };

    const stop = store.sub(count$, () => {
      ++notifications;
    });

    expect(store.get(count$)).toBe(1);
    expect(notifications).toBe(0);
    stop();
  });

  it("runs an effect once and abandons stale mount work after a reentrant branch change", () => {
    const choose$ = signal(false);
    const left$ = signal(0);
    const right$ = signal(1);
    const staleTail$ = signal(0);
    const store = createStore();
    const mounts = { left: 0, right: 0, staleTail: 0 };
    const cleanups = { left: 0, right: 0, staleTail: 0 };
    let effectRuns = 0;

    left$.onMount = () => {
      ++mounts.left;
      choose$.set(true);
      return () => {
        ++cleanups.left;
      };
    };
    right$.onMount = () => {
      ++mounts.right;
      return () => {
        ++cleanups.right;
      };
    };
    staleTail$.onMount = () => {
      ++mounts.staleTail;
      return () => {
        ++cleanups.staleTail;
      };
    };

    const stop = store.run(() =>
      effect(
        () =>
          choose$()
            ? right$()
            : left$() + staleTail$(),
        () => {
          ++effectRuns;
        },
      ),
    );

    expect(effectRuns).toBe(1);
    expect(mounts).toEqual({ left: 1, right: 1, staleTail: 0 });
    expect(cleanups).toEqual({ left: 1, right: 0, staleTail: 0 });

    stop();
    expect(cleanups).toEqual({ left: 1, right: 1, staleTail: 0 });
  });
});

describe("effect dispatch semantics", () => {
  it("skips primitive no-ops but runs once for an atomic reverted write", () => {
    const count$ = signal(0);
    const revert$ = signal(
      () => null,
      () => {
        count$.set(1);
        count$.set(0);
      },
    );
    const store = createStore();
    const effectValues: number[] = [];
    let ordinaryNotifications = 0;

    const stopEffect = store.run(() =>
      effect(
        () => count$(),
        () => {
          effectValues.push(count$());
        },
      ),
    );
    const stopOrdinary = store.sub(count$, () => {
      ++ordinaryNotifications;
    });

    store.run(() => count$.set(0));
    expect(effectValues).toEqual([0]);

    store.run(() => revert$.set());
    expect(effectValues).toEqual([0, 0]);
    expect(ordinaryNotifications).toBe(0);
    expect(store.getSnapshot().values.has(count$)).toBe(true);

    stopOrdinary();
    stopEffect();
  });

  it("keeps separate writes inside store.run as separate dispatches", () => {
    const count$ = signal(0);
    const store = createStore();
    const effectValues: number[] = [];

    const stopEffect = store.run(() =>
      effect(
        () => count$(),
        () => {
          effectValues.push(count$());
        },
      ),
    );

    store.run(() => {
      count$.set(1);
      count$.set(0);
    });

    expect(effectValues).toEqual([0, 1, 0]);
    stopEffect();
  });
});
