import {
  StrictMode,
  Suspense,
  startTransition,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  act,
  cleanup,
  render,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  Provider,
  createStore,
  signal,
  useObserve,
  type Snapshot,
} from "../src";

afterEach(() => {
  cleanup();
});

type Lifecycle = {
  mounts: number;
  unmounts: number;
};

type Gate = {
  readonly label: string;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

let nextHarnessId = 0;

const createGate = (label: string): Gate => {
  let finish!: () => void;
  let resolved = false;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    label,
    promise,
    resolve: () => {
      if (!resolved) {
        resolved = true;
        finish();
      }
    },
  };
};

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

const encodeTuple = (
  revision: number,
  left: number,
  right: number,
  chooseRight: boolean,
  selected: number,
  total: number,
) =>
  [
    revision,
    left,
    right,
    chooseRight ? 1 : 0,
    selected,
    total,
  ].join(":");

const createGraph = () => {
  const revision$ = signal(0);
  const left$ = signal(0);
  const right$ = signal(1);
  const chooseRight$ = signal(false);
  const selected$ = signal(() =>
    chooseRight$() ? right$() : left$(),
  );
  const total$ = signal(() => left$() + right$());
  const fingerprint$ = signal(() =>
    encodeTuple(
      revision$(),
      left$(),
      right$(),
      chooseRight$(),
      selected$(),
      total$(),
    ),
  );

  const writeRevision = (revision: number) => {
    revision$.set(revision);
    left$.set(revision * 2);
    right$.set(revision * 2 + 1);
    chooseRight$.set(revision % 2 !== 0);
    return revision;
  };
  const setRevision$ = signal(
    () => revision$(),
    (revision: number) => writeRevision(revision),
  );
  const advance$ = signal(
    () => revision$(),
    (delta: number) => writeRevision(revision$() + delta),
  );
  const store = createStore();
  const lifecycles = new Map<string, Lifecycle>();

  for (const [name, node] of [
    ["revision", revision$],
    ["left", left$],
    ["right", right$],
    ["chooseRight", chooseRight$],
  ] as const) {
    const lifecycle = { mounts: 0, unmounts: 0 };
    lifecycles.set(name, lifecycle);
    node.onMount = () => {
      ++lifecycle.mounts;
      return () => {
        ++lifecycle.unmounts;
      };
    };
  }

  return {
    advance$,
    chooseRight$,
    fingerprint$,
    left$,
    lifecycles,
    revision$,
    right$,
    selected$,
    setRevision$,
    store,
    total$,
  };
};

type Graph = ReturnType<typeof createGraph>;
type HarnessMode = "provider" | "explicit";

const readSnapshotTuple = (graph: Graph, snapshot: Snapshot) =>
  graph.store.getFromSnapshot(graph.fingerprint$, snapshot);

const assertSnapshotInternals = (
  graph: Graph,
  snapshot: Snapshot,
  context: string,
) => {
  const revision = graph.store.getFromSnapshot(
    graph.revision$,
    snapshot,
  );
  const left = graph.store.getFromSnapshot(graph.left$, snapshot);
  const right = graph.store.getFromSnapshot(graph.right$, snapshot);
  const chooseRight = graph.store.getFromSnapshot(
    graph.chooseRight$,
    snapshot,
  );
  const selected = graph.store.getFromSnapshot(
    graph.selected$,
    snapshot,
  );
  const total = graph.store.getFromSnapshot(graph.total$, snapshot);
  const expected = encodeTuple(
    revision,
    revision * 2,
    revision * 2 + 1,
    revision % 2 !== 0,
    revision % 2 !== 0 ? revision * 2 + 1 : revision * 2,
    revision * 4 + 1,
  );
  const actual = encodeTuple(
    revision,
    left,
    right,
    chooseRight,
    selected,
    total,
  );
  if (actual !== expected) {
    throw new Error(
      `${context}: internally inconsistent snapshot ${actual}; expected ${expected}`,
    );
  }
};

const mountHarness = async (
  label: string,
  mode: HarnessMode = "provider",
) => {
  const id = `concurrency-harness-${++nextHarnessId}`;
  const graph = createGraph();
  const trace: string[] = [`${label}:mount`];
  let setObserverCount!: (count: number) => void;

  const fail = (message: string): never => {
    throw new Error(
      `${label}: ${message}\nTrace:\n${trace
        .map((entry, index) => `${index}: ${entry}`)
        .join("\n")}`,
    );
  };

  const verifyCommittedDom = (stage: string) => {
    const root = document.querySelector<HTMLElement>(
      `[data-concurrency-harness="${id}"]`,
    );
    if (!root) {
      fail(`${stage}: mounted harness DOM is missing`);
    }
    const mountedRoot = root as HTMLElement;
    const probes = Array.from(
      mountedRoot.querySelectorAll<HTMLElement>("[data-snapshot-probe]"),
    );
    const visible = [
      mountedRoot.dataset.auditFingerprint,
      ...probes.map((probe) => probe.dataset.snapshotProbe),
    ];
    if (
      visible.some((fingerprint) => !fingerprint) ||
      new Set(visible).size !== 1
    ) {
      fail(`${stage}: observers committed mixed snapshots: ${visible.join(" | ")}`);
    }

    const head = graph.store.getSnapshot();
    const committed = graph.store.getCommittedSnapshot();
    assertSnapshotInternals(graph, head, `${label}/${stage}/head`);
    assertSnapshotInternals(
      graph,
      committed,
      `${label}/${stage}/committed`,
    );
    const headTuple = readSnapshotTuple(graph, head);
    const committedTuple = readSnapshotTuple(graph, committed);
    if (visible[0] !== headTuple && visible[0] !== committedTuple) {
      fail(
        `${stage}: visible tuple ${visible[0]} matches neither head ${headTuple} nor committed ${committedTuple}`,
      );
    }
  };

  const assertMounted = (stage: string) => {
    for (const [name, lifecycle] of graph.lifecycles) {
      const active = lifecycle.mounts - lifecycle.unmounts;
      if (active !== 1) {
        fail(
          `${stage}: ${name} has ${active} active mounts (${lifecycle.mounts} mounts, ${lifecycle.unmounts} unmounts)`,
        );
      }
    }
    if (graph.store.concurrentStore.listenerCount() < 1) {
      fail(`${stage}: mounted store has no listeners`);
    }
  };

  const assertReleased = (stage: string) => {
    for (const [name, lifecycle] of graph.lifecycles) {
      if (lifecycle.mounts !== lifecycle.unmounts) {
        fail(
          `${stage}: ${name} leaked a mount (${lifecycle.mounts} mounts, ${lifecycle.unmounts} unmounts)`,
        );
      }
    }
    if (graph.store.concurrentStore.listenerCount() !== 0) {
      fail(
        `${stage}: store retained ${graph.store.concurrentStore.listenerCount()} listeners`,
      );
    }
  };

  const useGraphObserve = <Value,>(read: () => Value) =>
    useObserve(
      read,
      mode === "explicit" ? { store: graph.store } : undefined,
    );

  const SnapshotProbe = ({ index }: { index: number }) => {
    const revision = useGraphObserve(() => graph.revision$());
    const left = useGraphObserve(() => graph.left$());
    const right = useGraphObserve(() => graph.right$());
    const chooseRight = useGraphObserve(() => graph.chooseRight$());
    const selected = useGraphObserve(() => graph.selected$());
    const total = useGraphObserve(() => graph.total$());
    const fingerprint = useGraphObserve(() => graph.fingerprint$());
    const expected = encodeTuple(
      revision,
      revision * 2,
      revision * 2 + 1,
      revision % 2 !== 0,
      revision % 2 !== 0 ? revision * 2 + 1 : revision * 2,
      revision * 4 + 1,
    );
    const actual = encodeTuple(
      revision,
      left,
      right,
      chooseRight,
      selected,
      total,
    );
    if (actual !== expected || fingerprint !== expected) {
      fail(
        `probe ${index} tore during render: fields=${actual}, fingerprint=${fingerprint}, expected=${expected}`,
      );
    }
    return (
      <output
        data-probe-index={index}
        data-snapshot-probe={fingerprint}
      >
        {fingerprint}
      </output>
    );
  };

  const Audit = ({ observerCount }: { observerCount: number }) => {
    const fingerprint = useGraphObserve(() => graph.fingerprint$());
    return (
      <section
        data-audit-fingerprint={fingerprint}
        data-concurrency-harness={id}
      >
        {Array.from({ length: observerCount }, (_, index) => (
          <SnapshotProbe index={index} key={index} />
        ))}
      </section>
    );
  };

  const App = () => {
    const [observerCount, updateObserverCount] = useState(1);
    setObserverCount = updateObserverCount;
    const content = <Audit observerCount={observerCount} />;
    return mode === "provider" ? (
      <Provider store={graph.store}>
        {content}
      </Provider>
    ) : (
      content
    );
  };

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
  verifyCommittedDom("initial commit");
  assertMounted("initial commit");

  return {
    assertMounted,
    assertReleased,
    graph,
    getObserverCount: () =>
      view.container.querySelectorAll("[data-snapshot-probe]").length,
    setObserverCount: (count: number) => {
      setObserverCount(count);
    },
    trace,
    verifyCommittedDom,
    view,
  };
};

type Harness = Awaited<ReturnType<typeof mountHarness>>;

const startPendingTransition = async (
  harness: Harness,
  delta: number,
  label: string,
  observerCount?: number,
) => {
  const gate = createGate(label);
  harness.trace.push(
    `${label}: start transition delta=${delta}${
      observerCount === undefined ? "" : ` observers=${observerCount}`
    }`,
  );
  await act(async () => {
    startTransition(async () => {
      if (observerCount !== undefined) {
        harness.setObserverCount(observerCount);
      }
      harness.graph.store.run(() => harness.graph.advance$.set(delta));
      await gate.promise;
    });
  });
  return gate;
};

const resolveGate = async (
  harness: Harness,
  gate: Gate,
  label: string,
) => {
  harness.trace.push(`${label}: resolve ${gate.label}`);
  await act(async () => {
    gate.resolve();
  });
};

const permutations = <Value,>(values: readonly Value[]): Value[][] => {
  if (values.length < 2) {
    return [Array.from(values)];
  }
  const result: Value[][] = [];
  for (let index = 0; index < values.length; ++index) {
    const remaining = values.filter(
      (_, candidateIndex) => candidateIndex !== index,
    );
    for (const suffix of permutations(remaining)) {
      result.push([values[index], ...suffix]);
    }
  }
  return result;
};

describe("bounded concurrent rendering interleavings", () => {
  it(
    "keeps every observer coherent for every ordering of transition, sync write, mount, and resolution",
    async () => {
      const orderings = permutations([
        "transition",
        "sync",
        "mount",
        "resolve",
      ] as const).filter(
        (ordering) =>
          ordering.indexOf("transition") < ordering.indexOf("resolve"),
      );
      expect(orderings).toHaveLength(12);

      for (const mode of ["provider", "explicit"] as const) {
        for (const ordering of orderings) {
          const label = `${mode} ordering ${ordering.join(" -> ")}`;
          const harness = await mountHarness(label, mode);
          let gate: Gate | undefined;

          for (const operation of ordering) {
            harness.trace.push(operation);
            if (operation === "transition") {
              gate = await startPendingTransition(
                harness,
                1,
                "ordered transition",
              );
            } else if (operation === "sync") {
              await act(async () => {
                harness.graph.store.run(() =>
                  harness.graph.advance$.set(10),
                );
              });
            } else if (operation === "mount") {
              await act(async () => {
                harness.setObserverCount(4);
              });
              expect(harness.getObserverCount()).toBe(4);
            } else {
              if (!gate) {
                throw new Error(`${label}: resolve preceded transition`);
              }
              await resolveGate(harness, gate, "ordered resolution");
            }
            harness.verifyCommittedDom(operation);
            harness.assertMounted(operation);
          }

          expect(harness.graph.store.get(harness.graph.revision$)).toBe(11);
          expect(
            harness.graph.store.getFromSnapshot(
              harness.graph.revision$,
              harness.graph.store.getCommittedSnapshot(),
            ),
          ).toBe(11);

          await act(async () => {
            harness.view.unmount();
          });
          harness.assertReleased("ordered scenario unmount");
        }
      }
    },
    30_000,
  );

  it(
    "keeps every observer coherent across all legal orderings of two transitions, sync work, mount, and both resolutions",
    async () => {
      const orderings = permutations([
        "transition-a",
        "transition-b",
        "sync",
        "mount",
        "resolve-a",
        "resolve-b",
      ] as const).filter(
        (ordering) =>
          ordering.indexOf("transition-a") <
            ordering.indexOf("resolve-a") &&
          ordering.indexOf("transition-b") <
            ordering.indexOf("resolve-b"),
      );
      expect(orderings).toHaveLength(180);

      for (const mode of ["provider", "explicit"] as const) {
        for (const ordering of orderings) {
          const label = `${mode} dual ordering ${ordering.join(" -> ")}`;
          const harness = await mountHarness(label, mode);
          let firstGate: Gate | undefined;
          let secondGate: Gate | undefined;

          for (const operation of ordering) {
            harness.trace.push(operation);
            if (operation === "transition-a") {
              firstGate = await startPendingTransition(
                harness,
                1,
                "first ordered transition",
              );
            } else if (operation === "transition-b") {
              secondGate = await startPendingTransition(
                harness,
                3,
                "second ordered transition",
              );
            } else if (operation === "sync") {
              await act(async () => {
                harness.graph.store.run(() =>
                  harness.graph.advance$.set(10),
                );
              });
            } else if (operation === "mount") {
              await act(async () => {
                harness.setObserverCount(4);
              });
              expect(harness.getObserverCount()).toBe(4);
            } else if (operation === "resolve-a") {
              if (!firstGate) {
                throw new Error(
                  `${label}: first resolution preceded its transition`,
                );
              }
              await resolveGate(
                harness,
                firstGate,
                "first ordered resolution",
              );
            } else {
              if (!secondGate) {
                throw new Error(
                  `${label}: second resolution preceded its transition`,
                );
              }
              await resolveGate(
                harness,
                secondGate,
                "second ordered resolution",
              );
            }
            harness.verifyCommittedDom(operation);
            harness.assertMounted(operation);
          }

          expect(harness.graph.store.get(harness.graph.revision$)).toBe(14);
          expect(
            harness.graph.store.getFromSnapshot(
              harness.graph.revision$,
              harness.graph.store.getCommittedSnapshot(),
            ),
          ).toBe(14);

          await act(async () => {
            harness.view.unmount();
          });
          harness.assertReleased("dual ordered scenario unmount");
        }
      }
    },
    60_000,
  );
});

describe("overlapping store isolation", () => {
  it("keeps independently rebased stores coherent through reverse transition resolution", async () => {
    for (const mode of ["provider", "explicit"] as const) {
      const count$ = signal(0);
      const doubled$ = signal(() => count$() * 2);
      const firstStore = createStore();
      const secondStore = createStore();
      firstStore.run(() => count$.set(1));
      secondStore.run(() => count$.set(100));

      const StoreValue = ({
        label,
        store,
      }: {
        label: string;
        store: ReturnType<typeof createStore>;
      }) => {
        const count = useObserve(
          () => count$(),
          mode === "explicit" ? { store } : undefined,
        );
        const doubled = useObserve(
          () => doubled$(),
          mode === "explicit" ? { store } : undefined,
        );
        if (doubled !== count * 2) {
          throw new Error(
            `${mode}/${label} tore during render: ${count}:${doubled}`,
          );
        }
        return (
          <output data-store-group={label}>
            {count}:{doubled}
          </output>
        );
      };
      const Group = ({
        label,
        store,
      }: {
        label: string;
        store: ReturnType<typeof createStore>;
      }) => {
        const contents = (
          <>
            <StoreValue label={label} store={store} />
            <StoreValue label={label} store={store} />
            <StoreValue label={label} store={store} />
          </>
        );
        return mode === "provider" ? (
          <Provider store={store}>{contents}</Provider>
        ) : (
          contents
        );
      };
      const view = render(
        <StrictMode>
          <Group label={`${mode}-first`} store={firstStore} />
          <Group label={`${mode}-second`} store={secondStore} />
        </StrictMode>,
      );

      const verifyStore = (
        label: string,
        store: ReturnType<typeof createStore>,
      ) => {
        const visible = Array.from(
          view.container.querySelectorAll<HTMLElement>(
            `[data-store-group="${label}"]`,
          ),
        ).map((node) => node.textContent);
        expect(visible).toHaveLength(3);
        expect(new Set(visible).size).toBe(1);
        const tuple = (snapshot: Snapshot) => {
          const count = store.getFromSnapshot(count$, snapshot);
          return `${count}:${store.getFromSnapshot(doubled$, snapshot)}`;
        };
        const head = tuple(store.getSnapshot());
        const committed = tuple(store.getCommittedSnapshot());
        if (visible[0] !== head && visible[0] !== committed) {
          throw new Error(
            `${mode}/${label} visible ${visible[0]} matches neither head ${head} nor committed ${committed}`,
          );
        }
      };
      const verifyBoth = () => {
        verifyStore(`${mode}-first`, firstStore);
        verifyStore(`${mode}-second`, secondStore);
      };
      verifyBoth();

      const firstGate = createGate(`${mode} first store`);
      const secondGate = createGate(`${mode} second store`);
      await act(async () => {
        startTransition(async () => {
          firstStore.run(() => count$.set((count) => count + 1));
          await firstGate.promise;
        });
        startTransition(async () => {
          secondStore.run(() => count$.set((count) => count + 10));
          await secondGate.promise;
        });
      });
      verifyBoth();

      await act(async () => {
        firstStore.run(() => count$.set((count) => count + 100));
        secondStore.run(() => count$.set((count) => count * 2));
      });
      expect(
        view.container.querySelector(
          `[data-store-group="${mode}-first"]`,
        )?.textContent,
      ).toBe("101:202");
      expect(
        view.container.querySelector(
          `[data-store-group="${mode}-second"]`,
        )?.textContent,
      ).toBe("200:400");
      verifyBoth();

      await act(async () => {
        secondGate.resolve();
      });
      verifyBoth();
      await act(async () => {
        firstGate.resolve();
      });
      verifyBoth();
      expect(firstStore.get(count$)).toBe(102);
      expect(secondStore.get(count$)).toBe(220);

      await act(async () => {
        view.unmount();
      });
      expect(firstStore.concurrentStore.listenerCount()).toBe(0);
      expect(secondStore.concurrentStore.listenerCount()).toBe(0);
    }
  });
});

describe("Provider store replacement", () => {
  it("ignores pending work from a store after the Provider moves to another store", async () => {
    const count$ = signal(0);
    const doubled$ = signal(() => count$() * 2);
    const firstStore = createStore();
    const secondStore = createStore();
    firstStore.run(() => count$.set(1));
    secondStore.run(() => count$.set(100));
    let switchStore!: (store: typeof firstStore) => void;

    const Probe = ({ index }: { index: number }) => {
      const count = useObserve(() => count$());
      const doubled = useObserve(() => doubled$());
      if (doubled !== count * 2) {
        throw new Error(
          `Provider replacement probe ${index} tore: ${count}:${doubled}`,
        );
      }
      return <output data-provider-replacement>{count}:{doubled}</output>;
    };
    const App = () => {
      const [store, setStore] = useState(firstStore);
      switchStore = setStore;
      return (
        <Provider store={store}>
          <Probe index={0} />
          <Probe index={1} />
          <Probe index={2} />
        </Provider>
      );
    };
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await act(async () => {});

    const visible = () =>
      Array.from(
        view.container.querySelectorAll("[data-provider-replacement]"),
      ).map((node) => node.textContent);
    const expectVisible = (value: string) => {
      expect(visible()).toEqual([value, value, value]);
    };
    expectVisible("1:2");

    const firstGate = createGate("detached first store");
    await act(async () => {
      startTransition(async () => {
        firstStore.run(() => count$.set((count) => count + 1));
        await firstGate.promise;
      });
    });
    expectVisible("1:2");

    await act(async () => {
      switchStore(secondStore);
    });
    expectVisible("100:200");
    expect(firstStore.concurrentStore.listenerCount()).toBe(0);

    await act(async () => {
      firstGate.resolve();
    });
    expectVisible("100:200");
    expect(firstStore.concurrentStore.listenerCount()).toBe(0);

    const secondGate = createGate("detached second store");
    await act(async () => {
      startTransition(async () => {
        secondStore.run(() => count$.set((count) => count + 10));
        await secondGate.promise;
      });
    });
    expectVisible("100:200");

    await act(async () => {
      switchStore(firstStore);
    });
    expectVisible("2:4");
    expect(secondStore.concurrentStore.listenerCount()).toBe(0);

    await act(async () => {
      secondGate.resolve();
    });
    expectVisible("2:4");
    expect(secondStore.concurrentStore.listenerCount()).toBe(0);

    await act(async () => {
      view.unmount();
    });
    expect(firstStore.concurrentStore.listenerCount()).toBe(0);
    expect(secondStore.concurrentStore.listenerCount()).toBe(0);
  });
});

const stressSeeds = [
  0,
  1,
  2,
  3,
  42,
  99,
  0x1234,
  0x5eed,
  0x27182818,
  0x31415926,
  0x7fffffff,
  0x80000000,
  0xabcdef01,
  0xc0ffee,
  0xdeadbeef,
  0xffffffff,
  ...Array.from(
    { length: 48 },
    (_, index) => Math.imul(index + 1, 0x9e3779b1) >>> 0,
  ),
];

describe("seeded concurrent rendering state machine", () => {
  it.each(stressSeeds)(
    "never commits a torn snapshot for seed %i",
    async (seed) => {
      const mode = seed % 2 === 0 ? "provider" : "explicit";
      const harness = await mountHarness(`${mode} seed ${seed}`, mode);
      const random = createRandom(seed);
      const pending: Gate[] = [];
      const deltas = [-11, -5, -2, -1, 1, 2, 3, 7, 13];
      const absoluteValues = [-7, -3, -1, 0, 1, 2, 5, 8, 13];
      let observerCount = 1;

      const randomItem = <Value,>(values: readonly Value[]) =>
        values[Math.floor(random() * values.length)];
      const resolveRandomPending = async (step: number) => {
        const index = Math.floor(random() * pending.length);
        const [gate] = pending.splice(index, 1);
        await resolveGate(harness, gate, `step ${step}`);
      };

      for (let step = 0; step < 96; ++step) {
        const action = Math.floor(random() * 12);
        const delta = randomItem(deltas);
        harness.trace.push(`step ${step}: action ${action}`);

        if ((action === 0 || action === 1) && pending.length < 3) {
          pending.push(
            await startPendingTransition(
              harness,
              delta,
              `step ${step} relative`,
            ),
          );
        } else if (action === 2) {
          await act(async () => {
            harness.graph.store.run(() =>
              harness.graph.advance$.set(delta),
            );
          });
        } else if (action === 3) {
          await act(async () => {
            flushSync(() => {
              harness.graph.store.run(() =>
                harness.graph.advance$.set(delta),
              );
            });
          });
        } else if (action === 4) {
          const secondDelta = randomItem(deltas);
          await act(async () => {
            harness.graph.store.run(() => {
              harness.graph.advance$.set(delta);
              harness.graph.advance$.set(secondDelta);
            });
          });
        } else if (action === 5) {
          const revision = randomItem(absoluteValues);
          await act(async () => {
            harness.graph.store.run(() =>
              harness.graph.setRevision$.set(revision),
            );
          });
        } else if (action === 6) {
          observerCount = Math.floor(random() * 6);
          await act(async () => {
            harness.setObserverCount(observerCount);
          });
          expect(harness.getObserverCount()).toBe(observerCount);
        } else if (action === 7 && pending.length < 3) {
          observerCount = Math.floor(random() * 6);
          pending.push(
            await startPendingTransition(
              harness,
              delta,
              `step ${step} observer churn`,
              observerCount,
            ),
          );
        } else if (action === 8 && pending.length) {
          await resolveRandomPending(step);
        } else if (action === 9 && pending.length < 3) {
          const revision = randomItem(absoluteValues);
          const gate = createGate(`step ${step} absolute`);
          pending.push(gate);
          await act(async () => {
            startTransition(async () => {
              harness.graph.store.run(() =>
                harness.graph.setRevision$.set(revision),
              );
              await gate.promise;
            });
          });
        } else if (action === 10) {
          const current = harness.graph.store.get(
            harness.graph.revision$,
          );
          await act(async () => {
            harness.graph.store.run(() =>
              harness.graph.setRevision$.set(current),
            );
          });
        } else if (pending.length) {
          await resolveRandomPending(step);
        } else {
          await act(async () => {
            harness.graph.store.run(() =>
              harness.graph.advance$.set(delta),
            );
          });
        }

        harness.verifyCommittedDom(`step ${step}`);
        harness.assertMounted(`step ${step}`);
      }

      if (seed % 2 === 0) {
        while (pending.length) {
          await resolveRandomPending(96);
          harness.verifyCommittedDom("drain pending transitions");
          harness.assertMounted("drain pending transitions");
        }
        await act(async () => {
          harness.view.unmount();
        });
        harness.assertReleased("resolved stress unmount");
      } else {
        if (!pending.length) {
          pending.push(
            await startPendingTransition(
              harness,
              1,
              "pending unmount transition",
            ),
          );
        }
        await act(async () => {
          harness.view.unmount();
        });
        harness.assertReleased("pending stress unmount");
        while (pending.length) {
          const gate = pending.pop() as Gate;
          await act(async () => {
            gate.resolve();
          });
          harness.assertReleased(
            `resolution after unmount (${gate.label})`,
          );
        }
      }
    },
    20_000,
  );
});

describe("actual Suspense interruption", () => {
  it("never publishes a stale suspended transition over newer sync state", async () => {
    const graph = createGraph();
    const resources = new Map<number, string | Promise<string>>();
    const resolvedResource = (revision: number) => {
      let resource = resources.get(revision);
      if (!resource) {
        resource = `async:${revision}`;
        resources.set(revision, resource);
      }
      return resource;
    };
    const asyncValue$ = signal(() =>
      resolvedResource(graph.revision$()),
    );

    const SynchronousValue = () => {
      const fingerprint = useObserve(() => graph.fingerprint$());
      return <output data-testid="suspense-sync">{fingerprint}</output>;
    };
    const AsyncValue = () => {
      const value = useObserve(() => asyncValue$());
      return <output data-testid="suspense-async">{value}</output>;
    };
    const App = () => (
      <StrictMode>
        <Provider store={graph.store}>
          <Suspense fallback={<div data-testid="suspense-fallback">loading</div>}>
            <SynchronousValue />
            <AsyncValue />
          </Suspense>
        </Provider>
      </StrictMode>
    );

    const view = render(<App />);
    await act(async () => {});
    expect(
      document.querySelector("[data-testid=suspense-sync]")?.textContent,
    ).toBe("0:0:1:0:0:1");
    expect(
      document.querySelector("[data-testid=suspense-async]")?.textContent,
    ).toBe("async:0");

    let resolveOne!: (value: string) => void;
    resources.set(
      1,
      new Promise<string>((resolve) => {
        resolveOne = resolve;
      }),
    );
    await act(async () => {
      startTransition(() => {
        graph.store.run(() => graph.setRevision$.set(1));
      });
    });
    expect(
      document.querySelector("[data-testid=suspense-sync]")?.textContent,
    ).toBe("0:0:1:0:0:1");
    expect(
      document.querySelector("[data-testid=suspense-async]")?.textContent,
    ).toBe("async:0");
    expect(
      document.querySelector("[data-testid=suspense-fallback]"),
    ).toBeNull();

    await act(async () => {
      graph.store.run(() => graph.setRevision$.set(2));
    });
    expect(
      document.querySelector("[data-testid=suspense-sync]")?.textContent,
    ).toBe("2:4:5:0:4:9");
    expect(
      document.querySelector("[data-testid=suspense-async]")?.textContent,
    ).toBe("async:2");

    await act(async () => {
      resolveOne("async:1");
    });
    expect(
      document.querySelector("[data-testid=suspense-sync]")?.textContent,
    ).toBe("2:4:5:0:4:9");
    expect(
      document.querySelector("[data-testid=suspense-async]")?.textContent,
    ).toBe("async:2");

    let resolveThree!: (value: string) => void;
    resources.set(
      3,
      new Promise<string>((resolve) => {
        resolveThree = resolve;
      }),
    );
    await act(async () => {
      startTransition(() => {
        graph.store.run(() => graph.setRevision$.set(3));
      });
    });
    await act(async () => {
      view.unmount();
    });
    expect(graph.store.concurrentStore.listenerCount()).toBe(0);
    for (const lifecycle of graph.lifecycles.values()) {
      expect(lifecycle.mounts).toBe(lifecycle.unmounts);
    }

    await act(async () => {
      resolveThree("async:3");
    });
    expect(graph.store.concurrentStore.listenerCount()).toBe(0);
    for (const lifecycle of graph.lifecycles.values()) {
      expect(lifecycle.mounts).toBe(lifecycle.unmounts);
    }
  });
});

describe("hydration concurrency", () => {
  it("hydrates one snapshot and rebases sync work over a pending transition without tearing", async () => {
    const graph = createGraph();
    const Values = ({ index }: { index: number }) => {
      const revision = useObserve(() => graph.revision$());
      const fingerprint = useObserve(() => graph.fingerprint$());
      const expected = encodeTuple(
        revision,
        revision * 2,
        revision * 2 + 1,
        revision % 2 !== 0,
        revision % 2 !== 0 ? revision * 2 + 1 : revision * 2,
        revision * 4 + 1,
      );
      if (fingerprint !== expected) {
        throw new Error(
          `hydration observer ${index} tore: ${fingerprint} !== ${expected}`,
        );
      }
      return <output data-hydration-value={fingerprint}>{fingerprint}</output>;
    };
    const App = () => (
      <StrictMode>
        <Provider store={graph.store}>
          <Values index={0} />
          <Values index={1} />
          <Values index={2} />
        </Provider>
      </StrictMode>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(<App />);
    document.body.append(container);
    expect(graph.store.concurrentStore.listenerCount()).toBe(0);

    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, <App />);
    });
    const readVisible = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-hydration-value]"),
      ).map((node) => node.dataset.hydrationValue);
    expect(new Set(readVisible())).toEqual(new Set(["0:0:1:0:0:1"]));

    const gate = createGate("hydration transition");
    await act(async () => {
      startTransition(async () => {
        graph.store.run(() => graph.advance$.set(1));
        await gate.promise;
      });
    });
    expect(new Set(readVisible())).toEqual(new Set(["0:0:1:0:0:1"]));

    await act(async () => {
      graph.store.run(() => graph.advance$.set(10));
    });
    expect(new Set(readVisible())).toEqual(new Set(["10:20:21:0:20:41"]));

    await act(async () => {
      gate.resolve();
    });
    expect(new Set(readVisible())).toEqual(new Set(["11:22:23:1:23:45"]));

    await act(async () => {
      root.unmount();
    });
    container.remove();
    expect(graph.store.concurrentStore.listenerCount()).toBe(0);
    for (const lifecycle of graph.lifecycles.values()) {
      expect(lifecycle.mounts).toBe(lifecycle.unmounts);
    }
  });
});
