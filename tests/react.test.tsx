import * as React from "react";
import {
  Suspense,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Provider, createStore, signal, useObserve, useStore } from "../src";

afterEach(() => {
  cleanup();
});

it("supports useObserve with direct default-store signal writes", async () => {
  const count$ = signal(0);

  const Counter = () => {
    const count = useObserve(() => count$());
    const doubled = useObserve(() => count$() * 2);
    return (
      <>
        <div>count: {count}</div>
        <div>doubled: {doubled}</div>
        <button onClick={() => count$.set((count) => count + 1)}>
          increment
        </button>
      </>
    );
  };

  await act(async () => {
    render(<Counter />);
  });

  expect(screen.getByText("count: 0")).toBeInTheDocument();
  expect(screen.getByText("doubled: 0")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByText("increment"));
  });

  expect(screen.getByText("count: 1")).toBeInTheDocument();
  expect(screen.getByText("doubled: 2")).toBeInTheDocument();
});

it("supports scoped providers with store.run writes", async () => {
  const count$ = signal(0);
  const storeA = createStore();
  const storeB = createStore();
  storeA.run(() => count$.set(1));
  storeB.run(() => count$.set(2));

  const Count = ({ label }: { label: string }) => {
    const count = useObserve(() => count$());
    return (
      <>
        <div>
          {label}: {count}
        </div>
        <ScopedIncrement />
      </>
    );
  };

  const ScopedIncrement = () => {
    const store = useStore();
    return (
      <button onClick={() => store.run(() => count$.set((count) => count + 1))}>
        increment scoped
      </button>
    );
  };

  await act(async () => {
    render(
      <>
        <Provider store={storeA}>
          <Count label="a" />
        </Provider>
        <Provider store={storeB}>
          <Count label="b" />
        </Provider>
      </>,
    );
  });

  expect(screen.getByText("a: 1")).toBeInTheDocument();
  expect(screen.getByText("b: 2")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getAllByText("increment scoped")[1]);
  });

  expect(screen.getByText("a: 1")).toBeInTheDocument();
  expect(screen.getByText("b: 3")).toBeInTheDocument();
});

it("does not re-render observers for unrelated signal changes", async () => {
  const count$ = signal(0);
  const unrelated$ = signal(0);
  const store = createStore();
  let countRenders = 0;

  const Count = () => {
    const count = useObserve(() => count$());
    ++countRenders;
    return <div>count: {count}</div>;
  };

  const Control = () => {
    const store = useStore();
    return (
      <button
        onClick={() => store.run(() => unrelated$.set((value) => value + 1))}
      >
        update
      </button>
    );
  };

  await act(async () => {
    render(
      <Provider store={store}>
        <Count />
        <Control />
      </Provider>,
    );
  });

  expect(countRenders).toBe(1);

  await act(async () => {
    fireEvent.click(screen.getByText("update"));
  });

  expect(screen.getByText("count: 0")).toBeInTheDocument();
  expect(countRenders).toBe(1);
});

describe("concurrent safety", () => {
  it("does not tear when a new observer mounts during a pending transition", async () => {
    const count$ = signal(1);
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Count testid="count" />
          {showOther && <Count testid="otherCount" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set((count) => count + 1));
        await new Promise<void>((r) => {
          resolve = r;
        });
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await act(async () => {
      setShowOther(true);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("1");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("2");
  });

  it("does not tear when a new observer mounts in its own transition during a pending transition", async () => {
    const count$ = signal(1);
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Count testid="count" />
          {showOther && <Count testid="otherCount" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set((count) => count + 1));
        await new Promise<void>((r) => {
          resolve = r;
        });
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await act(async () => {
      startTransition(() => {
        setShowOther(true);
      });
    });

    expect(screen.queryByTestId("otherCount")).not.toBeInTheDocument();

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("2");
  });

  it("rebases sync updates over pending transition updates", async () => {
    const count$ = signal(2);
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Count testid="count" />
          {showOther && <Count testid="otherCount" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set((count) => count * 2));
        await new Promise<void>((r) => {
          resolve = r;
        });
      });
    });

    await act(async () => {
      store.run(() => count$.set((count) => count + 1));
      setShowOther(true);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("3");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("5");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("5");
  });

  it("rebases multiple sync updates over a pending transition", async () => {
    const count$ = signal(2);
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Count testid="count" />
          {showOther && <Count testid="otherCount" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set((count) => count * 2));
        await new Promise<void>((r) => {
          resolve = r;
        });
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("2");

    await act(async () => {
      store.run(() => {
        count$.set((count) => count + 1);
        count$.set((count) => count + 1);
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");

    await act(async () => {
      setShowOther(true);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("4");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("6");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("6");
  });

  it("rebases flushSync updates over a pending transition", async () => {
    const count$ = signal(2);
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Count testid="count" />
          {showOther && <Count testid="otherCount" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set((count) => count + 1));
        await new Promise<void>((r) => {
          resolve = r;
        });
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("2");

    await act(async () => {
      flushSync(() => {
        store.run(() => count$.set((count) => count * 2));
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");

    await act(async () => {
      setShowOther(true);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("4");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("6");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("6");
  });

  it("does not miss transition updates triggered in effects or layout effects", async () => {
    const count$ = signal(1);
    const store = createStore();

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const IncrementOnMount = () => {
      useEffect(() => {
        startTransition(() => {
          store.run(() => count$.set((count) => count + 1));
        });
      }, []);
      return null;
    };

    const IncrementOnLayout = () => {
      useLayoutEffect(() => {
        startTransition(() => {
          store.run(() => count$.set((count) => count + 1));
        });
      }, []);
      return null;
    };

    const { rerender } = render(
      <Provider store={store}>
        <IncrementOnMount />
        <Count testid="count" />
      </Provider>,
    );

    await act(async () => {});
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    await act(async () => {
      rerender(
        <Provider store={store}>
          <Count testid="count" />
          <IncrementOnMount />
          <Count testid="otherCount" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("3");

    await act(async () => {
      rerender(
        <Provider store={store}>
          <IncrementOnLayout />
          <Count testid="count" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");

    await act(async () => {
      rerender(
        <Provider store={store}>
          <Count testid="count" />
          <IncrementOnLayout />
          <Count testid="otherCount" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("5");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("5");
  });

  it("does not miss sync updates triggered in effects during a long-running transition", async () => {
    const count$ = signal(2);
    const store = createStore();

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const IncrementOnMount = () => {
      useEffect(() => {
        store.run(() => count$.set((count) => count + 1));
      }, []);
      return null;
    };

    const IncrementOnLayout = () => {
      useLayoutEffect(() => {
        store.run(() => count$.set((count) => count + 1));
      }, []);
      return null;
    };

    let resolve!: () => void;
    startTransition(async () => {
      store.run(() => count$.set((count) => count * 2));
      await new Promise<void>((r) => {
        resolve = r;
      });
    });

    const { rerender } = render(
      <Provider store={store}>
        <IncrementOnMount />
        <Count testid="count" />
      </Provider>,
    );

    await act(async () => {});
    expect(screen.getByTestId("count")).toHaveTextContent("3");

    await act(async () => {
      rerender(
        <Provider store={store}>
          <Count testid="count" />
          <IncrementOnMount />
          <Count testid="otherCount" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("4");

    await act(async () => {
      rerender(
        <Provider store={store}>
          <IncrementOnLayout />
          <Count testid="count" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("5");

    await act(async () => {
      rerender(
        <Provider store={store}>
          <Count testid="count" />
          <IncrementOnLayout />
          <Count testid="otherCount" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("6");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("6");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("8");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("8");
  });

  it("handles consecutive sync updates in one batch", async () => {
    const count$ = signal(1);
    const store = createStore();
    let renders = 0;

    const Count = () => {
      const count = useObserve(() => count$());
      ++renders;
      return <div>count: {count}</div>;
    };

    await act(async () => {
      render(
        <Provider store={store}>
          <Count />
        </Provider>,
      );
    });

    expect(screen.getByText("count: 1")).toBeInTheDocument();

    await act(async () => {
      store.run(() => {
        count$.set((count) => count + 1);
        count$.set((count) => count + 1);
      });
    });

    expect(screen.getByText("count: 3")).toBeInTheDocument();
    expect(renders).toBe(2);
  });

  it("rebases a sync update over multiple pending transitions", async () => {
    const count$ = signal(1);
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Count testid="count" />
          {showOther && <Count testid="otherCount" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => count$.set((count) => count + 1));
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      });
      startTransition(async () => {
        store.run(() => count$.set((count) => count * 10));
        await new Promise<void>((resolve) => {
          resolveSecond = resolve;
        });
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");

    await act(async () => {
      store.run(() => count$.set((count) => count + 100));
      setShowOther(true);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("101");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("101");

    await act(async () => {
      resolveSecond();
      resolveFirst();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("120");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("120");
  });

  it("rebases complex derived writes without tearing derived observers", async () => {
    const left$ = signal(1);
    const right$ = signal(2);
    const total$ = signal(() => left$() + right$());
    const scaleBoth$ = signal(
      () => null,
      (factor: number) => {
        left$.set(left$() * factor);
        right$.set(right$() * factor);
      },
    );
    const addBoth$ = signal(
      () => null,
      (amount: number) => {
        left$.set(left$() + amount);
        right$.set(right$() + amount);
      },
    );
    const store = createStore();
    let setShowOther!: (value: boolean) => void;

    const Total = ({ testid }: { testid: string }) => {
      const total = useObserve(() => total$());
      return <div data-testid={testid}>{total}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Total testid="total" />
          {showOther && <Total testid="otherTotal" />}
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    let resolve!: () => void;
    await act(async () => {
      startTransition(async () => {
        store.run(() => scaleBoth$.set(2));
        await new Promise<void>((r) => {
          resolve = r;
        });
      });
    });

    expect(screen.getByTestId("total")).toHaveTextContent("3");

    await act(async () => {
      store.run(() => addBoth$.set(10));
      setShowOther(true);
    });

    expect(screen.getByTestId("total")).toHaveTextContent("23");
    expect(screen.getByTestId("otherTotal")).toHaveTextContent("23");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("total")).toHaveTextContent("26");
    expect(screen.getByTestId("otherTotal")).toHaveTextContent("26");
  });

  it("updates derived signals immediately when sync dependency changes during a pending transition", async () => {
    const count$ = signal(1);
    const multiplier$ = signal(1);
    const result$ = signal(() => count$() * multiplier$());
    let resolve!: () => void;

    const Counter = () => {
      const count = useObserve(() => count$());
      const multiplier = useObserve(() => multiplier$());
      const result = useObserve(() => result$());
      const store = useStore();
      return (
        <>
          <div>count: {count}</div>
          <div>multiplier: {multiplier}</div>
          <div>result: {result}</div>
          <button
            onClick={() => {
              startTransition(async () => {
                store.run(() => count$.set((value) => value + 1));
                await new Promise<void>((r) => {
                  resolve = r;
                });
              });
            }}
          >
            slow+
          </button>
          <button
            onClick={() =>
              store.run(() => multiplier$.set((value) => value + 1))
            }
          >
            multiplier+
          </button>
        </>
      );
    };

    await act(async () => {
      render(
        <Provider>
          <Counter />
        </Provider>,
      );
    });

    expect(screen.getByText("count: 1")).toBeInTheDocument();
    expect(screen.getByText("multiplier: 1")).toBeInTheDocument();
    expect(screen.getByText("result: 1")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("slow+"));
    });

    expect(screen.getByText("count: 1")).toBeInTheDocument();
    expect(screen.getByText("multiplier: 1")).toBeInTheDocument();
    expect(screen.getByText("result: 1")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("multiplier+"));
    });

    expect(screen.getByText("count: 1")).toBeInTheDocument();
    expect(screen.getByText("multiplier: 2")).toBeInTheDocument();
    expect(screen.getByText("result: 2")).toBeInTheDocument();

    await act(async () => {
      resolve();
    });

    expect(screen.getByText("count: 2")).toBeInTheDocument();
    expect(screen.getByText("multiplier: 2")).toBeInTheDocument();
    expect(screen.getByText("result: 4")).toBeInTheDocument();
  });

  it("lets a transition signal update mount a new observer", async () => {
    const count$ = signal(1);
    const store = createStore();
    const events: string[] = [];

    const Count = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      events.push(`render:${testid}:${count}`);
      useEffect(() => {
        events.push(`mount:${testid}:${count}`);
      }, [count, testid]);
      return <div data-testid={testid}>{count}</div>;
    };

    const CountIfEven = () => {
      const count = useObserve(() => count$());
      events.push(`render:countIfEven:${count}`);
      return <>{count % 2 === 0 ? <Count testid="count" /> : null}</>;
    };

    await act(async () => {
      render(
        <Provider store={store}>
          <CountIfEven />
        </Provider>,
      );
    });

    expect(screen.queryByTestId("count")).not.toBeInTheDocument();
    expect(events).toEqual(["render:countIfEven:1"]);
    events.length = 0;

    await act(async () => {
      startTransition(() => {
        store.run(() => count$.set((count) => count + 1));
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(events).toEqual([
      "render:countIfEven:2",
      "render:count:2",
      "mount:count:2",
    ]);
  });

  it("documents the known suspense limitation when transition state suspends on sync mount", async () => {
    const count$ = signal(1);
    const store = createStore();
    const events: string[] = [];
    let resolveSuspense!: () => void;
    const suspensePromise = new Promise<void>((resolve) => {
      resolveSuspense = resolve;
    }) as Promise<void> & { status?: string; value?: unknown };
    let setShowOther!: (value: boolean) => void;

    const SuspendOnEven = ({ testid }: { testid: string }) => {
      const count = useObserve(() => count$());
      if (count % 2 === 0) {
        if (suspensePromise.status !== "fulfilled") {
          events.push(`suspend:${testid}:${count}`);
        }
        use(suspensePromise as Promise<void>);
      }
      events.push(`render:${testid}:${count}`);
      return <div data-testid={testid}>{count}</div>;
    };

    const App = () => {
      const [showOther, updateShowOther] = useState(false);
      setShowOther = updateShowOther;
      return (
        <Provider store={store}>
          <Suspense fallback={<div data-testid="fallback">Loading...</div>}>
            <SuspendOnEven testid="count" />
            {showOther && <SuspendOnEven testid="otherCount" />}
          </Suspense>
        </Provider>
      );
    };

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(events).toEqual(["render:count:1"]);
    events.length = 0;

    await act(async () => {
      startTransition(() => {
        store.run(() => count$.set((count) => count + 1));
      });
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(events).toEqual(["suspend:count:2"]);
    events.length = 0;

    await act(async () => {
      setShowOther(true);
    });

    expect(screen.getByTestId("fallback")).toHaveTextContent("Loading...");
    expect(events).toEqual([
      "render:count:1",
      "suspend:otherCount:2",
      "suspend:count:2",
    ]);
    events.length = 0;

    await act(async () => {
      resolveSuspense();
    });

    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("otherCount")).toHaveTextContent("2");
    expect(events).toEqual(["render:count:2", "render:otherCount:2"]);
  });

  it("keeps separate scoped stores independent", async () => {
    const count$ = signal(0);
    const storeA = createStore();
    const storeB = createStore();

    const Count = ({ label }: { label: string }) => {
      const count = useObserve(() => count$());
      return <div>{label}: {count}</div>;
    };

    await act(async () => {
      render(
        <>
          <Provider store={storeA}>
            <Count label="a" />
          </Provider>
          <Provider store={storeB}>
            <Count label="b" />
          </Provider>
        </>,
      );
    });

    await act(async () => {
      storeB.run(() => count$.set((count) => count + 1));
    });

    expect(screen.getByText("a: 0")).toBeInTheDocument();
    expect(screen.getByText("b: 1")).toBeInTheDocument();
  });
});

describe("basic suspense", () => {
  it("suspends and resolves async observations", async () => {
    let resolve!: (value: string) => void;
    const async$ = signal(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );

    const Text = () => {
      const text = useObserve(() => async$());
      return <div>text: {text}</div>;
    };

    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <Text />
        </Suspense>,
      );
    });

    expect(screen.getByText("loading")).toBeInTheDocument();

    await act(async () => {
      resolve("done");
    });

    expect(screen.getByText("text: done")).toBeInTheDocument();
  });

  it("keeps previous async signal UI visible while a transition is pending", async () => {
    let count = -1;
    let resolve!: () => void;
    const nextPromise = () =>
      new Promise<number>((res) => {
        resolve = () => {
          count += 1;
          res(count);
        };
      });

    const async$ = signal(nextPromise());

    const Value = ({ pending }: { pending: boolean }) => {
      const value = useObserve(() => async$());
      return (
        <div data-testid="value" data-pending={pending}>
          {value}
        </div>
      );
    };

    const App = () => {
      const store = useStore();
      const [isPending, beginTransition] = useTransition();
      return (
        <>
          <button
            onClick={() => {
              beginTransition(() => {
                store.run(() => async$.set(nextPromise()));
              });
            }}
          >
            next
          </button>
          <Suspense fallback={<div data-testid="loading">loading</div>}>
            <Value pending={isPending} />
          </Suspense>
        </>
      );
    };

    await act(async () => {
      render(
        <Provider>
          <App />
        </Provider>,
      );
    });

    expect(screen.getByTestId("loading")).toBeInTheDocument();

    await act(async () => {
      resolve();
    });

    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("0");

    await act(async () => {
      fireEvent.click(screen.getByText("next"));
    });

    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("0");
    expect(screen.getByTestId("value")).toHaveAttribute("data-pending", "true");

    await act(async () => {
      resolve();
    });

    expect(screen.getByTestId("value")).toHaveTextContent("1");
    expect(screen.getByTestId("value")).toHaveAttribute("data-pending", "false");
  });

  it("propagates rejected async observations to an error boundary", async () => {
    const error$ = signal(() => Promise.reject(new Error("boom")));

    class ErrorBoundary extends React.Component<
      { children: ReactNode },
      { error: Error | null }
    > {
      state: { error: Error | null } = { error: null };

      static getDerivedStateFromError(error: Error) {
        return { error };
      }

      render() {
        if (this.state.error) {
          return <div>error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    const Broken = () => {
      useObserve(() => error$());
      return <div>ok</div>;
    };

    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback={<div>loading</div>}>
            <Broken />
          </Suspense>
        </ErrorBoundary>,
      );
    });

    expect(await screen.findByText("error: boom")).toBeInTheDocument();
  });

  it("keeps React.use compatibility for direct promises", async () => {
    let resolveSuspense!: () => void;
    const suspensePromise = new Promise<void>((resolve) => {
      resolveSuspense = resolve;
    });
    const ready$ = signal(false);

    const MaybeSuspends = () => {
      const ready = useObserve(() => ready$());
      if (!ready) {
        use(suspensePromise);
      }
      return <div>ready</div>;
    };

    await act(async () => {
      render(
        <Suspense fallback={<div>loading</div>}>
          <MaybeSuspends />
        </Suspense>,
      );
    });

    expect(screen.getByText("loading")).toBeInTheDocument();

    await act(async () => {
      ready$.set(true);
      resolveSuspense();
    });

    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
