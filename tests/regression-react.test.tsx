import {
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
  useState,
} from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Provider,
  createStore,
  effect,
  signal,
  useObserve,
} from "../src";

afterEach(() => {
  cleanup();
});

describe("useObserve callback freshness", () => {
  it("uses the latest render closure when a prop changes", async () => {
    const count$ = signal(2);
    const store = createStore();

    const Product = ({ multiplier }: { multiplier: number }) => {
      const product = useObserve(() => count$() * multiplier, { store });
      return <div data-testid="product">{product}</div>;
    };

    const view = render(<Product multiplier={2} />);
    expect(screen.getByTestId("product")).toHaveTextContent("4");

    await act(async () => {
      view.rerender(<Product multiplier={3} />);
    });

    expect(screen.getByTestId("product")).toHaveTextContent("6");
  });

  it("does not publish a callback from an aborted render", async () => {
    const count$ = signal(1);
    const store = createStore();
    let setMultiplier!: (value: number) => void;
    let resolve!: () => void;
    let blocked = true;
    const blocker = new Promise<void>((finish) => {
      resolve = finish;
    });

    const Product = ({ multiplier }: { multiplier: number }) => {
      const product = useObserve(() => count$() * multiplier, { store });
      if (multiplier === 3 && blocked) {
        throw blocker;
      }
      return <div data-testid="product">{product}</div>;
    };
    const App = () => {
      const [multiplier, setValue] = useState(2);
      setMultiplier = setValue;
      return (
        <Suspense fallback={<div>loading</div>}>
          <Product multiplier={multiplier} />
        </Suspense>
      );
    };

    render(<App />);
    await act(async () => {
      startTransition(() => {
        setMultiplier(3);
      });
    });
    expect(screen.getByTestId("product")).toHaveTextContent("2");

    await act(async () => {
      store.run(() => count$.set(2));
    });
    expect(screen.getByTestId("product")).toHaveTextContent("4");

    await act(async () => {
      blocked = false;
      resolve();
    });
    expect(screen.getByTestId("product")).toHaveTextContent("6");
  });

  it("refreshes dependencies when a changed closure has an equal result", async () => {
    const left$ = signal(1);
    const right$ = signal(1);
    const store = createStore();

    const Selected = ({ side }: { side: "left" | "right" }) => {
      const selected = useObserve(
        () => (side === "left" ? left$() : right$()),
        { store },
      );
      return <div data-testid="selected">{selected}</div>;
    };

    const view = render(<Selected side="left" />);
    expect(screen.getByTestId("selected")).toHaveTextContent("1");

    await act(async () => {
      view.rerender(<Selected side="right" />);
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("1");

    await act(async () => {
      store.run(() => right$.set(2));
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("2");

    await act(async () => {
      store.run(() => left$.set(3));
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("2");
  });

  it("catches a new-dependency write from an earlier sibling layout effect", async () => {
    const left$ = signal(0);
    const right$ = signal(0);
    const store = createStore();

    const Writer = ({ write }: { write: boolean }) => {
      useLayoutEffect(() => {
        if (write) {
          store.run(() => right$.set(1));
        }
      }, [write]);
      return null;
    };
    const Reader = ({ chooseRight }: { chooseRight: boolean }) => {
      const value = useObserve(
        () => (chooseRight ? right$() : left$()),
        { store },
      );
      return <div data-testid="race-value">{value}</div>;
    };

    const view = render(
      <>
        <Writer write={false} />
        <Reader chooseRight={false} />
      </>,
    );
    expect(screen.getByTestId("race-value")).toHaveTextContent("0");

    await act(async () => {
      view.rerender(
        <>
          <Writer write />
          <Reader chooseRight />
        </>,
      );
    });

    expect(store.get(right$)).toBe(1);
    expect(screen.getByTestId("race-value")).toHaveTextContent("1");
  });
});

describe("React notification ordering", () => {
  it("ignores an older outer snapshot after a nested write", async () => {
    const count$ = signal(0);
    const store = createStore();
    const stop = store.run(() =>
      effect(
        () => count$(),
        () => {
          if (count$() === 1) {
            count$.set(2);
          }
        },
      ),
    );
    const Count = () => {
      const count = useObserve(() => count$(), { store });
      return <div data-testid="count">{count}</div>;
    };
    render(<Count />);

    await act(async () => {
      store.run(() => count$.set(1));
    });
    expect(store.get(count$)).toBe(2);
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    stop();
  });
});

describe("shared commit tracking", () => {
  it("uses at most one default-store observer for an unrelated commit", async () => {
    const store = createStore();
    const unrelated$ = signal(0);
    const observed = Array.from({ length: 12 }, (_, index) =>
      signal(index),
    );
    const renders = observed.map(() => 0);
    const Item = ({ index }: { index: number }) => {
      ++renders[index];
      const value = useObserve(() => observed[index](), { store });
      return <span>{value}</span>;
    };

    render(
      <>
        {observed.map((_, index) => (
          <Item key={index} index={index} />
        ))}
      </>,
    );
    const before = renders.reduce((sum, count) => sum + count, 0);

    await act(async () => {
      store.run(() => unrelated$.set(1));
    });
    const after = renders.reduce((sum, count) => sum + count, 0);
    expect(after - before).toBeLessThanOrEqual(1);
  });

  it("catches a transition written by an earlier mount layout effect", async () => {
    const count$ = signal(0);
    const store = createStore();
    const Writer = () => {
      useLayoutEffect(() => {
        startTransition(() => {
          store.run(() => count$.set(1));
        });
      }, []);
      return null;
    };
    const Count = () => {
      const count = useObserve(() => count$());
      return <div data-testid="count">{count}</div>;
    };

    render(
      <Provider store={store}>
        <Writer />
        <Count />
      </Provider>,
    );
    await act(async () => {});

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(
      store.getFromSnapshot(count$, store.getCommittedSnapshot()),
    ).toBe(1);
  });
});

describe("observation mount lifecycle", () => {
  it("mounts observed signals and reconciles equal-valued dynamic branches", async () => {
    const useRight$ = signal(false);
    const left$ = signal(1);
    const right$ = signal(1);
    const store = createStore();
    const leftLifecycle = { mounts: 0, unmounts: 0 };
    const rightLifecycle = { mounts: 0, unmounts: 0 };

    left$.onMount = () => {
      ++leftLifecycle.mounts;
      return () => {
        ++leftLifecycle.unmounts;
      };
    };
    right$.onMount = () => {
      ++rightLifecycle.mounts;
      return () => {
        ++rightLifecycle.unmounts;
      };
    };

    const Selected = () => {
      const selected = useObserve(() =>
        useRight$() ? right$() : left$(),
      );
      return <div data-testid="selected">{selected}</div>;
    };

    const view = render(
      <Provider store={store}>
        <Selected />
      </Provider>,
    );

    expect(leftLifecycle).toEqual({ mounts: 1, unmounts: 0 });
    expect(rightLifecycle).toEqual({ mounts: 0, unmounts: 0 });

    await act(async () => {
      store.run(() => useRight$.set(true));
    });

    expect(screen.getByTestId("selected")).toHaveTextContent("1");
    expect(leftLifecycle).toEqual({ mounts: 1, unmounts: 1 });
    expect(rightLifecycle).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      view.unmount();
    });

    expect(leftLifecycle).toEqual({ mounts: 1, unmounts: 1 });
    expect(rightLifecycle).toEqual({ mounts: 1, unmounts: 1 });
  });
});

describe("store changes", () => {
  it("moves an observation to the new explicit store", async () => {
    const count$ = signal(0);
    const firstStore = createStore();
    const secondStore = createStore();
    firstStore.run(() => count$.set(1));
    secondStore.run(() => count$.set(10));

    const Count = ({ store }: { store: ReturnType<typeof createStore> }) => {
      const count = useObserve(() => count$(), { store });
      return <div data-testid="count">{count}</div>;
    };

    const view = render(<Count store={firstStore} />);
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await act(async () => {
      view.rerender(<Count store={secondStore} />);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("10");

    await act(async () => {
      firstStore.run(() => count$.set(2));
    });
    expect(screen.getByTestId("count")).toHaveTextContent("10");

    await act(async () => {
      secondStore.run(() => count$.set(11));
    });
    expect(screen.getByTestId("count")).toHaveTextContent("11");
  });
});

describe("server rendering", () => {
  it("reads an explicit store without retaining client subscriptions", () => {
    const count$ = signal(0);
    const store = createStore();
    store.run(() => count$.set(42));

    const Count = () => {
      const count = useObserve(() => count$());
      return <span>count:{count}</span>;
    };

    const html = renderToString(
      <Provider store={store}>
        <Count />
      </Provider>,
    );

    expect(html).toMatch(/count:(?:<!-- -->)?42/);
    expect(store.concurrentStore.listenerCount()).toBe(0);
  });
});

describe("concurrent reversion notifications", () => {
  it("renders a transition that reverts the latest synchronous value", async () => {
    const count$ = signal(0);
    const store = createStore();

    const Count = () => {
      const count = useObserve(() => count$());
      return <div data-testid="count">{count}</div>;
    };

    render(
      <Provider store={store}>
        <Count />
      </Provider>,
    );

    await act(async () => {
      store.run(() => count$.set(1));
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await act(async () => {
      startTransition(() => {
        store.run(() => count$.set(0));
      });
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("renders a synchronous write that reverts a committed transition", async () => {
    const count$ = signal(0);
    const store = createStore();

    const Count = () => {
      const count = useObserve(() => count$());
      return <div data-testid="count">{count}</div>;
    };

    render(
      <Provider store={store}>
        <Count />
      </Provider>,
    );

    await act(async () => {
      startTransition(() => {
        store.run(() => count$.set(1));
      });
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await act(async () => {
      store.run(() => count$.set(0));
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("runs effects only for the lane whose dependencies changed", () => {
    const chooseRight$ = signal(false);
    const left$ = signal(0);
    const right$ = signal(0);
    const store = createStore();
    let runs = 0;
    const stop = store.run(() =>
      effect(
        () => (chooseRight$() ? right$() : left$()),
        () => {
          ++runs;
        },
      ),
    );

    startTransition(() => {
      store.run(() => chooseRight$.set(true));
    });
    expect(runs).toBe(2);

    store.run(() => right$.set(1));
    expect(runs).toBe(3);
    stop();
  });

  it("preserves depth-first nested transitions and the pending write", () => {
    const pending$ = signal(0);
    const trigger$ = signal(0);
    const nested$ = signal(0);
    const store = createStore();
    startTransition(() => {
      store.run(() => pending$.set(1));
    });

    const events: string[] = [];
    let first = true;
    const stopFirst = store.sub(trigger$, () => {
      events.push("trigger:a");
      if (first) {
        first = false;
        startTransition(() => {
          store.run(() => nested$.set(1));
        });
      }
    });
    const stopNested = store.sub(nested$, () => {
      events.push("nested");
    });
    const stopLast = store.sub(trigger$, () => {
      events.push("trigger:b");
    });

    store.run(() => trigger$.set(1));

    expect(events).toEqual([
      "trigger:a",
      "nested",
      "trigger:b",
      "trigger:a",
      "trigger:b",
    ]);
    expect(store.get(nested$)).toBe(1);
    expect(
      store.getFromSnapshot(nested$, store.getCommittedSnapshot()),
    ).toBe(0);

    stopLast();
    stopNested();
    stopFirst();
  });

  it("advances committed dependencies despite a newer nested head event", () => {
    const pending$ = signal(0);
    const chooseRight$ = signal(false);
    const left$ = signal(0);
    const right$ = signal(1);
    const selected$ = signal(() =>
      chooseRight$() ? right$() : left$(),
    );
    const store = createStore();
    startTransition(() => {
      store.run(() => pending$.set(1));
    });

    let first = true;
    let firstCalls = 0;
    let secondCalls = 0;
    const stopFirst = store.sub(selected$, () => {
      ++firstCalls;
      if (first) {
        first = false;
        startTransition(() => {
          store.run(() => chooseRight$.set(false));
        });
      }
    });
    const stopSecond = store.sub(selected$, () => {
      ++secondCalls;
    });

    store.run(() => chooseRight$.set(true));
    const beforeRightWrite = secondCalls;
    store.run(() => right$.set(2));

    expect(firstCalls).toBeGreaterThan(0);
    expect(secondCalls).toBe(beforeRightWrite + 1);

    stopSecond();
    stopFirst();
  });
});

describe("StrictMode and pending work cleanup", () => {
  it("balances mounts and releases subscriptions after pending work unmounts", async () => {
    const count$ = signal(0);
    const store = createStore();
    let mounts = 0;
    let unmounts = 0;

    count$.onMount = () => {
      ++mounts;
      return () => {
        ++unmounts;
      };
    };

    const Count = () => {
      const count = useObserve(() => count$());
      return <div data-testid="count">{count}</div>;
    };

    const view = render(
      <StrictMode>
        <Provider store={store}>
          <Count />
        </Provider>
      </StrictMode>,
    );

    expect(mounts - unmounts).toBe(1);

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set(1));
        await new Promise<void>((finish) => {
          resolve = finish;
        });
      });
    });

    await act(async () => {
      view.unmount();
    });

    expect(mounts).toBe(unmounts);
    expect(store.concurrentStore.listenerCount()).toBe(0);

    await act(async () => {
      resolve();
    });

    expect(mounts).toBe(unmounts);
    expect(store.concurrentStore.listenerCount()).toBe(0);
  });
});
