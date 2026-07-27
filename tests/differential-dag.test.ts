import { startTransition } from "react";
import { describe, expect, it } from "vitest";
import "../src/react";
import {
  createStore,
  effect,
  signal,
  type Signal,
} from "../src/vanilla";

type NodeResult =
  | { readonly type: "value"; readonly value: number }
  | { readonly type: "error"; readonly error: unknown };

type OracleEvaluation = {
  readonly result: NodeResult;
  readonly primitives: ReadonlySet<number>;
};

type OracleNode =
  | { readonly kind: "primitive" }
  | {
      readonly kind: "derived";
      readonly read: (get: (node: number) => number) => number;
    };

type OracleSubscription = {
  readonly label: string;
  readonly node: number;
  readonly effect: boolean;
  evaluation: OracleEvaluation;
};

const didResultChange = (previous: NodeResult, next: NodeResult) => {
  if (previous.type !== next.type) {
    return true;
  }
  if (previous.type === "error" && next.type === "error") {
    return !Object.is(previous.error, next.error);
  }
  if (previous.type === "value" && next.type === "value") {
    return !Object.is(previous.value, next.value);
  }
  return true;
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

describe("seeded eager-oracle differential graph", () => {
  it("matches values, errors, dynamic leaves, and callback order", () => {
    const negativeError = new Error("negative control");
    const unluckyError = new Error("unlucky control");
    const oracleNodes: OracleNode[] = [];
    const runtimeNodes: Signal<number>[] = [];
    const primitiveValues: number[] = [];

    const addPrimitive = (initial: number) => {
      const node = oracleNodes.length;
      oracleNodes.push({ kind: "primitive" });
      primitiveValues[node] = initial;
      runtimeNodes.push(signal(initial));
      return node;
    };

    const addDerived = (
      read: (get: (node: number) => number) => number,
    ) => {
      const node = oracleNodes.length;
      oracleNodes.push({ kind: "derived", read });
      runtimeNodes.push(
        signal(() => read((dependency) => runtimeNodes[dependency]())),
      );
      return node;
    };

    const base = addPrimitive(1);
    const offset = addPrimitive(2);
    const leftInput = addPrimitive(3);
    const rightInput = addPrimitive(4);
    const selector = addPrimitive(0);
    const errorControl = addPrimitive(0);
    const equalLeft = addPrimitive(7);
    const equalRight = addPrimitive(7);

    // Chain.
    const chainA = addDerived((get) => get(base) + 1);
    const chainB = addDerived((get) => get(chainA) * 2);
    const chain = addDerived((get) => get(chainB) + get(offset));

    // Diamond, rooted at the chain.
    const diamondLeft = addDerived(
      (get) => get(chain) + get(leftInput),
    );
    const diamondRight = addDerived(
      (get) => get(chain) - get(rightInput),
    );
    const diamond = addDerived(
      (get) => get(diamondLeft) + get(diamondRight),
    );

    // Fan-out and fan-in.
    const fanA = addDerived((get) => get(diamond) * 2);
    const fanB = addDerived((get) => get(diamond) % 5);
    const fanC = addDerived((get) => Math.trunc(get(diamond) / 3));
    const fan = addDerived(
      (get) => get(fanA) + get(fanB) - get(fanC),
    );

    // Two dynamic branches. The second deliberately begins equal-valued so a
    // branch switch must still replace the dependency edge.
    const conditional = addDerived((get) =>
      get(selector) % 2 === 0 ? get(fan) : get(chain),
    );
    const equalConditional = addDerived((get) =>
      get(selector) % 2 === 0 ? get(equalLeft) : get(equalRight),
    );

    const errorNode = addDerived((get) => {
      const control = get(errorControl);
      if (control < 0) {
        throw negativeError;
      }
      if (control === 13) {
        throw unluckyError;
      }
      return get(conditional) + control;
    });
    const recoveredError = addDerived((get) => {
      try {
        return get(errorNode);
      } catch (error) {
        return error === negativeError ? -1_000 : -1_300;
      }
    });
    const root = addDerived(
      (get) => get(conditional) + get(recoveredError) + get(fan),
    );

    const evaluate = (
      target: number,
      memo = new Map<number, OracleEvaluation>(),
    ): OracleEvaluation => {
      const cached = memo.get(target);
      if (cached) {
        return cached;
      }
      const descriptor = oracleNodes[target];
      if (descriptor.kind === "primitive") {
        const evaluation: OracleEvaluation = {
          result: { type: "value", value: primitiveValues[target] },
          primitives: new Set([target]),
        };
        memo.set(target, evaluation);
        return evaluation;
      }

      const primitives = new Set<number>();
      let result: NodeResult;
      try {
        const value = descriptor.read((dependency) => {
          const dependencyEvaluation = evaluate(dependency, memo);
          for (const primitive of dependencyEvaluation.primitives) {
            primitives.add(primitive);
          }
          if (dependencyEvaluation.result.type === "error") {
            throw dependencyEvaluation.result.error;
          }
          return dependencyEvaluation.result.value;
        });
        result = { type: "value", value };
      } catch (error) {
        result = { type: "error", error };
      }
      const evaluation = { result, primitives };
      memo.set(target, evaluation);
      return evaluation;
    };

    const formatResult = (result: NodeResult) => {
      if (result.type === "value") {
        return `value:${Object.is(result.value, -0) ? "-0" : result.value}`;
      }
      if (result.error === negativeError) {
        return "error:negative";
      }
      if (result.error === unluckyError) {
        return "error:unlucky";
      }
      return "error:unknown";
    };

    const readRuntime = (node: number): NodeResult => {
      try {
        return { type: "value", value: store.get(runtimeNodes[node]) };
      } catch (error) {
        return { type: "error", error };
      }
    };

    const actualEvents: string[] = [];
    const expectedEvents: string[] = [];
    const oracleSubscriptions: OracleSubscription[] = [];
    const cleanups: (() => void)[] = [];
    const store = createStore();

    const register = (
      label: string,
      node: number,
      effectSubscription: boolean,
    ) => {
      oracleSubscriptions.push({
        label,
        node,
        effect: effectSubscription,
        evaluation: evaluate(node),
      });

      if (effectSubscription) {
        expectedEvents.push(
          `${label}:${formatResult(evaluate(node).result)}`,
        );
        cleanups.push(
          store.run(() =>
            effect(
              () => runtimeNodes[node](),
              () => {
                actualEvents.push(
                  `${label}:${formatResult(readRuntime(node))}`,
                );
              },
            ),
          ),
        );
      } else {
        cleanups.push(
          store.sub(runtimeNodes[node], () => {
            actualEvents.push(
              `${label}:${formatResult(readRuntime(node))}`,
            );
          }),
        );
      }
    };

    // Registration order is intentionally interleaved. It is also the exact
    // required delivery order for every candidate union.
    register("sub:root", root, false);
    register("effect:equal", equalConditional, true);
    register("sub:error", errorNode, false);
    register("effect:fan", fan, true);
    register("sub:chain", chain, false);
    register("sub:conditional", conditional, false);
    register("effect:recovered", recoveredError, true);
    register("sub:diamond", diamond, false);
    register("sub:equal", equalConditional, false);

    expect(actualEvents).toEqual(expectedEvents);

    const applyOracle = (writes: readonly [number, number][]) => {
      const changed = new Set<number>();
      for (const [primitive, value] of writes) {
        if (!Object.is(primitiveValues[primitive], value)) {
          primitiveValues[primitive] = value;
          changed.add(primitive);
        }
      }
      if (!changed.size) {
        return;
      }

      for (const subscription of oracleSubscriptions) {
        let relevant = false;
        for (const primitive of changed) {
          if (subscription.evaluation.primitives.has(primitive)) {
            relevant = true;
            break;
          }
        }
        if (!relevant) {
          continue;
        }
        const previous = subscription.evaluation;
        const next = evaluate(subscription.node);
        subscription.evaluation = next;
        if (
          subscription.effect ||
          didResultChange(previous.result, next.result)
        ) {
          expectedEvents.push(
            `${subscription.label}:${formatResult(next.result)}`,
          );
        }
      }
    };

    const batch$ = signal(
      () => 0,
      (writes: readonly [number, number][]) => {
        for (const [primitive, value] of writes) {
          const runtimePrimitive = runtimeNodes[primitive] as ReturnType<
            typeof signal<number>
          >;
          runtimePrimitive.set(value);
        }
      },
    );

    const runWrites = (
      writes: readonly [number, number][],
      description: string,
    ) => {
      applyOracle(writes);
      if (writes.length === 1) {
        const [primitive, value] = writes[0];
        const runtimePrimitive = runtimeNodes[primitive] as ReturnType<
          typeof signal<number>
        >;
        store.run(() => runtimePrimitive.set(value));
      } else {
        store.run(() => batch$.set(writes));
      }

      expect(
        actualEvents,
        `callback sequence after ${description}`,
      ).toEqual(expectedEvents);
      for (const node of [
        chain,
        diamond,
        fan,
        conditional,
        equalConditional,
        errorNode,
        recoveredError,
        root,
      ]) {
        expect(
          formatResult(readRuntime(node)),
          `node ${node} after ${description}`,
        ).toBe(formatResult(evaluate(node).result));
      }
    };

    // Deterministic edge cases before the random walk.
    runWrites([[selector, 1]], "equal-valued branch switch");
    runWrites([[equalLeft, 99]], "inactive old branch update");
    runWrites([[equalRight, 8]], "active new branch update");
    runWrites([[errorControl, -1]], "enter stable error");
    runWrites([[errorControl, -2]], "retain identical error object");
    runWrites([[errorControl, 13]], "change error identity");
    runWrites([[errorControl, 2]], "recover from error");
    runWrites(
      [
        [selector, 0],
        [equalLeft, 8],
        [leftInput, 9],
        [rightInput, -4],
      ],
      "atomic selector and diamond update",
    );
    runWrites(
      [
        [base, primitiveValues[base] + 1],
        [base, primitiveValues[base]],
      ],
      "atomic changed-then-reverted write",
    );

    const random = createRandom(0xa11e_51a7);
    const writablePrimitives = [
      base,
      offset,
      leftInput,
      rightInput,
      selector,
      errorControl,
      equalLeft,
      equalRight,
    ];
    const candidateValues = [-5, -2, -1, 0, 1, 2, 3, 7, 8, 13, 21];

    for (let step = 0; step < 180; ++step) {
      const writeCount = step % 17 === 0 ? 3 : step % 11 === 0 ? 2 : 1;
      const writes: [number, number][] = [];
      for (let write = 0; write < writeCount; ++write) {
        const primitive =
          writablePrimitives[
            Math.floor(random() * writablePrimitives.length)
          ];
        const value =
          candidateValues[Math.floor(random() * candidateValues.length)];
        writes.push([primitive, value]);
      }
      runWrites(writes, `seeded step ${step}`);
    }

    for (let index = cleanups.length - 1; index >= 0; --index) {
      cleanups[index]();
    }
  });

  it("retires the old committed dependencies after a mid-transition mount", () => {
    const selectRight$ = signal(false);
    const left$ = signal(1);
    const right$ = signal(2);
    const selected$ = signal(() =>
      selectRight$() ? right$() : left$(),
    );
    const store = createStore();
    const effectValues: number[] = [];

    startTransition(() => {
      store.run(() => selectRight$.set(true));
    });

    const stop = store.run(() =>
      effect(
        () => selected$(),
        () => effectValues.push(selected$()),
      ),
    );
    expect(effectValues).toEqual([2]);

    store.concurrentStore.commit(store.getSnapshot());
    store.run(() => left$.set(10));
    expect(effectValues).toEqual([2]);

    store.run(() => right$.set(20));
    expect(effectValues).toEqual([2, 20]);
    stop();
  });

  it("balances a mount that synchronously writes during subscription", () => {
    const count$ = signal(0);
    const store = createStore();
    let mounts = 0;
    let cleanups = 0;

    count$.onMount = (setCount) => {
      ++mounts;
      setCount(1);
      return () => {
        ++cleanups;
      };
    };

    const stop = store.sub(count$, () => {});
    expect(store.get(count$)).toBe(1);
    expect(mounts).toBe(1);

    stop();
    expect(cleanups).toBe(1);
  });

  it("rebases nested sync and transition writes without losing either lane", () => {
    const count$ = signal(0);
    const nested$ = signal(0);
    const store = createStore();

    startTransition(() => {
      store.run(() => count$.set(1));
    });

    let runNested = true;
    const stop = store.sub(count$, () => {
      if (!runNested) {
        return;
      }
      runNested = false;
      store.run(() => nested$.set(1));
    });

    store.run(() => count$.set(2));
    expect(store.get(count$)).toBe(2);
    expect(store.get(nested$)).toBe(1);
    expect(
      store.getFromSnapshot(nested$, store.getCommittedSnapshot()),
    ).toBe(1);
    stop();

    const transitioned$ = signal(0);
    startTransition(() => {
      store.run(() => count$.set(3));
    });
    runNested = true;
    const stopTransition = store.sub(count$, () => {
      if (!runNested) {
        return;
      }
      runNested = false;
      startTransition(() => {
        store.run(() => transitioned$.set(1));
      });
    });

    store.run(() => count$.set(4));
    expect(store.get(transitioned$)).toBe(1);
    expect(
      store.getFromSnapshot(
        transitioned$,
        store.getCommittedSnapshot(),
      ),
    ).toBe(0);
    stopTransition();

    const pendingCancel$ = signal(0);
    const trigger$ = signal(0);
    startTransition(() => {
      store.run(() => pendingCancel$.set(1));
    });
    const stopCancel = store.sub(trigger$, () => {
      store.run(() => pendingCancel$.set(0));
    });
    store.run(() => trigger$.set(1));
    expect(store.get(pendingCancel$)).toBe(0);
    expect(
      store.getFromSnapshot(
        pendingCancel$,
        store.getCommittedSnapshot(),
      ),
    ).toBe(0);
    stopCancel();

    startTransition(() => {
      store.run(() => pendingCancel$.set(1));
    });
    const stopTransitionCancel = store.sub(trigger$, () => {
      startTransition(() => {
        store.run(() => pendingCancel$.set(0));
      });
    });
    store.run(() => trigger$.set(2));
    expect(store.get(pendingCancel$)).toBe(0);
    stopTransitionCancel();
  });

  it("keeps pending head state when rebasing throws", () => {
    const pending$ = signal(0);
    const target$ = signal(0);
    const store = createStore();
    const writerFailure = new Error("committed branch failed");
    const listenerFailure = new Error("listener failed");

    startTransition(() => {
      store.run(() => pending$.set(1));
    });

    const writer$ = signal(
      () => target$(),
      () => {
        if (pending$() === 0) {
          throw writerFailure;
        }
        target$.set(1);
      },
    );

    expect(() => store.run(() => writer$.set())).toThrow(writerFailure);
    expect(store.get(pending$)).toBe(1);
    expect(store.get(target$)).toBe(0);
    expect(
      store.getFromSnapshot(pending$, store.getCommittedSnapshot()),
    ).toBe(0);

    const stop = store.sub(target$, () => {
      throw listenerFailure;
    });
    expect(() => store.run(() => target$.set(2))).toThrow(listenerFailure);
    expect(store.get(pending$)).toBe(1);
    expect(store.get(target$)).toBe(2);
    expect(
      store.getFromSnapshot(pending$, store.getCommittedSnapshot()),
    ).toBe(0);
    stop();
  });
});
