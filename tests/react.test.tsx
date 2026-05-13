import * as React from "react";
import {
  Suspense,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useState,
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

  it("does not miss updates triggered in effects or layout effects", async () => {
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
          <IncrementOnLayout />
          <Count testid="count" />
        </Provider>,
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("3");
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
