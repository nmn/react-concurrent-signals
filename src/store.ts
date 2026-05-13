import { ConcurrentStore, type NotificationPhase } from "./concurrent";
import {
  type AnyNode,
  type AnyPrimitiveSignal,
  type AnySignal,
  type AnyWritableSignal,
  type Observation,
  type Signal,
  type WritableSignal,
  isPrimitiveSignal,
  isSignal,
  isWritableSignal,
} from "./signal";
import {
  setDefaultStoreGetter,
  withReadContext,
  withStoreScope,
  withWriteContext,
} from "./scope";

export type SignalResult<Value> =
  | { readonly type: "value"; readonly value: Value }
  | { readonly type: "error"; readonly error: unknown };

export type Snapshot = {
  readonly values: ReadonlyMap<AnySignal, unknown>;
  readonly cache: WeakMap<AnyNode, SignalResult<unknown>>;
  readonly dependencies: WeakMap<AnyNode, ReadonlySet<AnySignal>>;
  readonly changedSignals: ReadonlySet<AnySignal>;
};

type SetAction = {
  readonly signal: AnyWritableSignal;
  readonly args: readonly unknown[];
};

type MountedSignal = {
  count: number;
  unmount?: () => void;
};

const initialSnapshot = (): Snapshot => ({
  values: new Map(),
  cache: new WeakMap(),
  dependencies: new WeakMap(),
  changedSignals: new Set(),
});

const createSnapshot = (
  values: ReadonlyMap<AnySignal, unknown>,
  changedSignals: ReadonlySet<AnySignal> = new Set(),
): Snapshot => ({
  values,
  cache: new WeakMap(),
  dependencies: new WeakMap(),
  changedSignals,
});

const returnResultValue = <Value>(result: SignalResult<Value>): Value => {
  if (result.type === "error") {
    throw result.error;
  }
  return result.value;
};

const didResultChange = (
  prev: SignalResult<unknown>,
  next: SignalResult<unknown>,
) => {
  if (prev.type !== next.type) {
    return true;
  }
  if (prev.type === "error" && next.type === "error") {
    return !Object.is(prev.error, next.error);
  }
  if (prev.type === "value" && next.type === "value") {
    return !Object.is(prev.value, next.value);
  }
  return true;
};

const hasChangedDependency = (
  dependencies: ReadonlySet<AnySignal>,
  changedSignals: ReadonlySet<AnySignal>,
) => {
  if (!changedSignals.size) {
    return true;
  }
  for (const signal of changedSignals) {
    if (dependencies.has(signal)) {
      return true;
    }
  }
  return false;
};

class SnapshotReader {
  constructor(
    private readonly store: Store,
    private readonly snapshot: Snapshot,
  ) {}

  readResult<Value>(node: Signal<Value> | Observation<Value>): SignalResult<Value> {
    const cached = this.snapshot.cache.get(node);
    if (cached) {
      return cached as SignalResult<Value>;
    }

    if (isSignal(node) && isPrimitiveSignal(node)) {
      const value = this.readPrimitive(node as AnyPrimitiveSignal) as Value;
      const result: SignalResult<Value> = { type: "value", value };
      this.snapshot.cache.set(node, result as SignalResult<unknown>);
      this.snapshot.dependencies.set(node, new Set());
      return result;
    }

    const dependencies = new Set<AnySignal>();
    const get = <DependencyValue>(dependency: Signal<DependencyValue>) => {
      const result = this.readResult(dependency);
      dependencies.add(dependency as AnySignal);
      const transitiveDependencies =
        this.snapshot.dependencies.get(dependency);
      if (transitiveDependencies) {
        for (const transitiveDependency of transitiveDependencies) {
          dependencies.add(transitiveDependency);
        }
      }
      return returnResultValue(result);
    };

    try {
      const value = withReadContext({ get }, () => node.INTERNAL_read?.());
      const result: SignalResult<Value> = { type: "value", value: value as Value };
      this.snapshot.cache.set(node, result as SignalResult<unknown>);
      this.snapshot.dependencies.set(node, dependencies);
      return result;
    } catch (error) {
      const result: SignalResult<Value> = { type: "error", error };
      this.snapshot.cache.set(node, result as SignalResult<unknown>);
      this.snapshot.dependencies.set(node, dependencies);
      return result;
    }
  }

  get<Value>(signal: Signal<Value>): Value {
    return returnResultValue(this.readResult(signal));
  }

  getObservation<Value>(observation: Observation<Value>): Value {
    return returnResultValue(this.readResult(observation));
  }

  private readPrimitive(signal: AnyPrimitiveSignal): unknown {
    if (this.snapshot.values.has(signal)) {
      return this.snapshot.values.get(signal);
    }
    return signal.init;
  }
}

class WriteDraft {
  private readonly values: Map<AnySignal, unknown>;
  private readonly changedSignals = new Set<AnySignal>();

  constructor(
    private readonly store: Store,
    snapshot: Snapshot,
  ) {
    this.values = new Map(snapshot.values);
  }

  run<Value, Args extends unknown[], Result>(
    signal: WritableSignal<Value, Args, Result>,
    ...args: Args
  ): Result {
    return this.writeSignal(signal as AnyWritableSignal, args) as Result;
  }

  finish(): Snapshot {
    return createSnapshot(this.values, this.changedSignals);
  }

  private writeSignal(
    signal: AnyWritableSignal,
    args: readonly unknown[],
  ): unknown {
    if (!isWritableSignal(signal)) {
      throw new Error("not writable signal");
    }
    if (isPrimitiveSignal(signal)) {
      return this.setPrimitive(signal, args);
    }
    if (!signal.INTERNAL_write) {
      throw new Error("not writable signal");
    }
    return withWriteContext(
      {
        get: (dependency) => this.get(dependency),
        set: (target, targetArgs) => this.set(target, targetArgs),
      },
      () => signal.INTERNAL_write?.(...args),
    );
  }

  private get<Value>(signal: Signal<Value>): Value {
    const snapshot = createSnapshot(this.values);
    return new SnapshotReader(this.store, snapshot).get(signal);
  }

  private set(signal: AnyWritableSignal, args: readonly unknown[]): unknown {
    if (isPrimitiveSignal(signal)) {
      return this.setPrimitive(signal, args);
    }
    return this.writeSignal(signal, args);
  }

  private setPrimitive(
    signal: AnyPrimitiveSignal,
    args: readonly unknown[],
  ): void {
    const prev = this.get(signal);
    const next =
      typeof args[0] === "function"
        ? (args[0] as (prev: unknown) => unknown)(prev)
        : args[0];
    if (!Object.is(prev, next)) {
      this.values.set(signal, next);
      this.changedSignals.add(signal);
    }
  }
}

export class Store {
  readonly concurrentStore: ConcurrentStore<Snapshot, SetAction>;
  private mountedSignals = new WeakMap<AnySignal, MountedSignal>();

  constructor() {
    this.concurrentStore = new ConcurrentStore<Snapshot, SetAction>(
      initialSnapshot(),
      (snapshot, action) => this.applyAction(snapshot, action).snapshot,
    );
  }

  run<Result>(fn: () => Result): Result {
    return withStoreScope(this, fn);
  }

  get<Value>(signal: Signal<Value>): Value {
    return this.getFromSnapshot(signal, this.concurrentStore.getState());
  }

  getFromSnapshot<Value>(signal: Signal<Value>, snapshot: Snapshot): Value {
    return returnResultValue(this.readResultFromSnapshot(signal, snapshot));
  }

  getObservationFromSnapshot<Value>(
    observation: Observation<Value>,
    snapshot: Snapshot,
  ): Value {
    return returnResultValue(
      this.readResultFromSnapshot(observation, snapshot),
    );
  }

  readResultFromSnapshot<Value>(
    node: Signal<Value> | Observation<Value>,
    snapshot: Snapshot,
  ): SignalResult<Value> {
    return new SnapshotReader(this, snapshot).readResult(node);
  }

  set<Value, Args extends unknown[], Result>(
    signal: WritableSignal<Value, Args, Result>,
    ...args: Args
  ): Result {
    if (!isWritableSignal(signal)) {
      throw new Error("not writable signal");
    }
    const action: SetAction = { signal: signal as AnyWritableSignal, args };
    const applied = this.applyAction(this.concurrentStore.getState(), action);
    if (!applied.snapshot.changedSignals.size) {
      return applied.result as Result;
    }
    this.concurrentStore.dispatch(action, applied.snapshot);
    return applied.result as Result;
  }

  sub(node: AnyNode, listener: () => void): () => void {
    const initialHeadSnapshot = this.concurrentStore.getState();
    const initialCommittedSnapshot = this.concurrentStore.getCommittedState();
    let headPrev = this.readResultFromSnapshot(node, initialHeadSnapshot);
    let committedPrev = this.readResultFromSnapshot(
      node,
      initialCommittedSnapshot,
    );
    let headDependencies = this.getSubscriptionDependencies(
      node,
      initialHeadSnapshot,
    );
    let committedDependencies = this.getSubscriptionDependencies(
      node,
      initialCommittedSnapshot,
    );
    const unmount = isSignal(node) ? this.mountSignal(node) : () => {};
    const unsubscribe = this.concurrentStore.subscribe((phase) => {
      const snapshot = this.getSnapshotForPhase(phase);
      const dependencies =
        phase === "sync" ? committedDependencies : headDependencies;
      if (!hasChangedDependency(dependencies, snapshot.changedSignals)) {
        return;
      }
      const next = this.readResultFromSnapshot(node, snapshot);
      const nextDependencies = this.getSubscriptionDependencies(node, snapshot);
      if (phase === "sync") {
        if (didResultChange(committedPrev, next)) {
          committedPrev = next;
          committedDependencies = nextDependencies;
          listener();
        }
        return;
      }
      if (didResultChange(headPrev, next)) {
        headPrev = next;
        headDependencies = nextDependencies;
        listener();
      }
    });
    return () => {
      unsubscribe();
      unmount();
    };
  }

  subEffect<Value>(
    observation: Observation<Value>,
    listener: (result: SignalResult<Value>) => void,
  ): () => void {
    const initialHeadSnapshot = this.concurrentStore.getState();
    const initialCommittedSnapshot = this.concurrentStore.getCommittedState();
    this.readResultFromSnapshot(observation, initialHeadSnapshot);
    this.readResultFromSnapshot(observation, initialCommittedSnapshot);
    let headDependencies = this.getSubscriptionDependencies(
      observation,
      initialHeadSnapshot,
    );
    let committedDependencies = this.getSubscriptionDependencies(
      observation,
      initialCommittedSnapshot,
    );
    return this.concurrentStore.subscribe((phase) => {
      const snapshot = this.getSnapshotForPhase(phase);
      const dependencies =
        phase === "sync" ? committedDependencies : headDependencies;
      if (!hasChangedDependency(dependencies, snapshot.changedSignals)) {
        return;
      }
      const next = this.readResultFromSnapshot(observation, snapshot);
      const nextDependencies = this.getSubscriptionDependencies(
        observation,
        snapshot,
      );
      if (phase === "sync") {
        committedDependencies = nextDependencies;
      } else {
        headDependencies = nextDependencies;
      }
      listener(next);
    });
  }

  mountSignal(signal: AnySignal): () => void {
    const mounted = this.mountedSignals.get(signal);
    if (mounted) {
      ++mounted.count;
      return () => this.unmountSignal(signal);
    }
    const nextMounted: MountedSignal = { count: 1 };
    this.mountedSignals.set(signal, nextMounted);
    signal.INTERNAL_onInit?.(this);
    if (isWritableSignal(signal) && signal.onMount) {
      const setSignal = ((...args: unknown[]) =>
        this.set(signal, ...args)) as (...args: unknown[]) => unknown;
      const cleanup = signal.onMount(setSignal as never);
      if (cleanup) {
        nextMounted.unmount = cleanup;
      }
    }
    return () => this.unmountSignal(signal);
  }

  getSnapshot() {
    return this.concurrentStore.getState();
  }

  getCommittedSnapshot() {
    return this.concurrentStore.getCommittedState();
  }

  private unmountSignal(signal: AnySignal) {
    const mounted = this.mountedSignals.get(signal);
    if (!mounted) {
      return;
    }
    --mounted.count;
    if (mounted.count < 1) {
      mounted.unmount?.();
      this.mountedSignals.delete(signal);
    }
  }

  private applyAction(snapshot: Snapshot, action: SetAction) {
    const draft = new WriteDraft(this, snapshot);
    const result = draft.run(action.signal, ...action.args);
    return { snapshot: draft.finish(), result };
  }

  private getSnapshotForPhase(phase: NotificationPhase) {
    return phase === "sync"
      ? this.concurrentStore.getCommittedState()
      : this.concurrentStore.getState();
  }

  private getSubscriptionDependencies(node: AnyNode, snapshot: Snapshot) {
    const dependencies = new Set(snapshot.dependencies.get(node));
    if (isSignal(node)) {
      dependencies.add(node);
    }
    return dependencies;
  }
}

let defaultStore: Store | undefined;

export function createStore(): Store {
  return new Store();
}

export function getDefaultStore(): Store {
  defaultStore ||= createStore();
  return defaultStore;
}

setDefaultStoreGetter(getDefaultStore);
