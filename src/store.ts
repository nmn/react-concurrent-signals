import {
  ConcurrentStore,
  INTERNAL_getConcurrentStoreActionState,
  INTERNAL_setConcurrentStoreHooks,
  type ConcurrentStoreChange,
  type ConcurrentStoreHooks,
  type NotificationPhase,
} from "./concurrent";
import {
  INTERNAL_hasEmitterListeners,
  INTERNAL_notifyEmitterSelected,
  INTERNAL_registerEmitterVirtualListener,
  INTERNAL_unregisterEmitterVirtualListener,
  type INTERNAL_EmitterOrdered,
} from "./emitter";
import {
  PersistentValues,
  type PersistentValueEntry,
  type PersistentValuesDraft,
} from "./persistent-values";
import {
  type AnyNode,
  type AnyObservation,
  type AnyPrimitiveSignal,
  type AnySignal,
  type AnyWritableSignal,
  type Observation,
  type Signal,
  type WritableSignal,
  getObservationVersion,
  getPrimitiveDependencySet,
  getSignalId,
  isPrimitiveSignal,
  isSignal,
  isWritableSignal,
  signal,
} from "./signal";
import {
  getActiveStore,
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

type SetAction =
  | {
      readonly kind: "primitive";
      readonly signal: AnyPrimitiveSignal;
      readonly value: unknown;
    }
  | {
      readonly kind: "derived";
      readonly signal: AnyWritableSignal;
      readonly args: readonly unknown[];
    }
  | {
      readonly kind?: undefined;
      readonly signal: AnyWritableSignal;
      readonly args: readonly unknown[];
    };

type MountedSignal = {
  count: number;
  unmount?: () => void;
};

type ValueEntry = PersistentValueEntry<AnySignal, unknown>;

type ValueSource = {
  getEntry(id: number): ValueEntry | undefined;
};

type DependencyRecord = {
  readonly node: AnySignal;
  readonly revision: unknown;
  readonly candidates: EvaluationCandidates | undefined;
};

type Evaluation<Value = unknown> = {
  readonly result: SignalResult<Value>;
  readonly revision: unknown;
  readonly directDependencies: readonly DependencyRecord[];
  observationVersion?: number;
  candidates?: EvaluationCandidates;
};

type DependencyCollector = {
  readonly previous: readonly DependencyRecord[] | undefined;
  readonly dependencies: DependencyRecord[];
  index: number;
};

const internalValues = Symbol();
const internalEvaluations = Symbol();
const materializedValues = Symbol();

type EvaluationState = {
  readonly [internalValues]: ValueSource;
  readonly cache: WeakMap<AnyNode, SignalResult<unknown>>;
  readonly changedSignals: ReadonlySet<AnySignal>;
  readonly dependencies: WeakMap<AnyNode, ReadonlySet<AnySignal>>;
  readonly [internalEvaluations]: WeakMap<AnyNode, Evaluation>;
};

type InternalSnapshot = Snapshot & {
  readonly [internalValues]: PersistentValues<AnySignal, unknown>;
  readonly [internalEvaluations]: WeakMap<AnyNode, Evaluation>;
};

class SnapshotImpl implements InternalSnapshot {
  readonly [internalValues]: PersistentValues<AnySignal, unknown>;
  readonly cache = new WeakMap<AnyNode, SignalResult<unknown>>();
  readonly dependencies = new WeakMap<
    AnyNode,
    ReadonlySet<AnySignal>
  >();
  private [materializedValues]?: ReadonlyMap<AnySignal, unknown>;
  private _evaluations?: WeakMap<AnyNode, Evaluation>;

  constructor(
    values: PersistentValues<AnySignal, unknown>,
    readonly changedSignals: ReadonlySet<AnySignal>,
  ) {
    this[internalValues] = values;
  }

  get values(): ReadonlyMap<AnySignal, unknown> {
    return (
      this[materializedValues] ||=
        this[internalValues].toMap()
    );
  }

  get [internalEvaluations](): WeakMap<AnyNode, Evaluation> {
    return (this._evaluations ||= new WeakMap());
  }

}

type EvaluationCandidates = {
  first?: Evaluation;
  second?: Evaluation;
};

type CollectedDependencies = {
  readonly all: ReadonlySet<AnySignal>;
  readonly primitives: ReadonlySet<AnyPrimitiveSignal>;
};

type SubscriptionState<Value = unknown> = CollectedDependencies & {
  readonly snapshot: Snapshot;
  readonly result: SignalResult<Value>;
  readonly directDependencies: readonly DependencyRecord[];
};

const haveSameSetMembers = <Value>(
  left: ReadonlySet<Value>,
  right: ReadonlySet<Value>,
) => {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
};

export type INTERNAL_StoreSubscriptionEvent<Value> = {
  readonly sequence: number;
  readonly phase: NotificationPhase;
  readonly snapshot: Snapshot;
  readonly result: SignalResult<Value>;
  readonly previousSnapshot: Snapshot;
};

export type INTERNAL_BasicStoreSubscription<Value> = {
  readonly result: SignalResult<Value>;
  readonly unsubscribe: () => void;
};

export type INTERNAL_StoreSubscription<Value> =
  INTERNAL_BasicStoreSubscription<Value> & {
    readonly refresh: (
      snapshot: Snapshot,
      lane?: NotificationPhase | "both",
    ) => SignalResult<Value>;
    readonly refreshFromRender: (
      snapshot: Snapshot,
      lane: NotificationPhase,
    ) => SignalResult<Value>;
  };

export interface Store {
  readonly concurrentStore: ConcurrentStore<Snapshot, SetAction>;
  run<Result>(fn: () => Result): Result;
  get<Value>(signal: Signal<Value>): Value;
  getFromSnapshot<Value>(signal: Signal<Value>, snapshot: Snapshot): Value;
  getObservationFromSnapshot<Value>(
    observation: Observation<Value>,
    snapshot: Snapshot,
  ): Value;
  readResultFromSnapshot<Value>(
    node: Signal<Value> | Observation<Value>,
    snapshot: Snapshot,
  ): SignalResult<Value>;
  set<Value, Args extends unknown[], Result>(
    signal: WritableSignal<Value, Args, Result>,
    ...args: Args
  ): Result;
  sub(node: AnyNode, listener: () => void): () => void;
  subEffect<Value>(
    observation: Observation<Value>,
    listener: (result: SignalResult<Value>) => void,
  ): () => void;
  mountSignal(signal: AnySignal): () => void;
  getSnapshot(): Snapshot;
  getCommittedSnapshot(): Snapshot;
}

type SubscriptionRecord<Value = unknown> = {
  readonly order: INTERNAL_EmitterOrdered["order"];
  readonly node: Signal<Value> | Observation<Value>;
  readonly listener: (event: INTERNAL_StoreSubscriptionEvent<Value>) => void;
  readonly effect: boolean;
  readonly resultOnly: boolean;
  readonly staticDependencies: boolean;
  active: boolean;
  initialized: boolean;
  queuedEpoch: number;
  headSequence: number;
  committedSequence: number;
  dependencyVersion: number;
  head: SubscriptionState<Value>;
  committed: SubscriptionState<Value>;
  indexedDependencies: ReadonlySet<AnyPrimitiveSignal>;
  mountedDependencies: ReadonlySet<AnySignal>;
  mountedSignals?: Set<AnySignal>;
};

type AnySubscriptionRecord = SubscriptionRecord<any>;

type NotificationReaders = {
  readonly previousSnapshot: Snapshot;
  readonly nextSnapshot: Snapshot;
  previousReader?: SnapshotReader;
  nextReader?: SnapshotReader;
};

type NotificationContext = {
  readonly change: ConcurrentStoreChange<Snapshot>;
  readonly epoch: number;
  readonly nextStates:
    | WeakMap<AnyNode, SubscriptionState>
    | undefined;
  readonly readers: NotificationReaders;
  readonly parent: NotificationContext | undefined;
};

const EMPTY_CHANGED_SIGNALS: ReadonlySet<AnySignal> = new Set();
const EMPTY_DIRECT_DEPENDENCIES: readonly DependencyRecord[] = [];
const EMPTY_DEPENDENCIES: ReadonlySet<AnyPrimitiveSignal> = new Set();
const createSnapshot = (
  values: PersistentValues<AnySignal, unknown>,
  changedSignals: ReadonlySet<AnySignal> = EMPTY_CHANGED_SIGNALS,
): InternalSnapshot => new SnapshotImpl(values, changedSignals);

const initialSnapshot = () =>
  createSnapshot(PersistentValues.empty<AnySignal, unknown>());

const returnResultValue = <Value>(result: SignalResult<Value>): Value => {
  if (result.type === "error") {
    throw result.error;
  }
  return result.value;
};

export const INTERNAL_didResultChange = (
  previous: SignalResult<unknown>,
  next: SignalResult<unknown>,
) => {
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

class LazyDependencySet extends Set<AnySignal> {
  private materialized: Set<AnySignal> | undefined;

  constructor(private readonly collect: () => Set<AnySignal>) {
    super();
  }

  get size(): number {
    return this.getMaterialized().size;
  }

  has(value: AnySignal): boolean {
    return this.getMaterialized().has(value);
  }

  entries(): SetIterator<[AnySignal, AnySignal]> {
    return this.getMaterialized().entries();
  }

  keys(): SetIterator<AnySignal> {
    return this.getMaterialized().keys();
  }

  values(): SetIterator<AnySignal> {
    return this.getMaterialized().values();
  }

  forEach(
    callbackfn: (
      value: AnySignal,
      value2: AnySignal,
      set: Set<AnySignal>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this.getMaterialized()) {
      callbackfn.call(thisArg, value, value, this);
    }
  }

  [Symbol.iterator](): SetIterator<AnySignal> {
    return this.values();
  }

  private getMaterialized(): Set<AnySignal> {
    return (this.materialized ||= this.collect());
  }
}

class SnapshotReader {
  private contextDepth = 0;
  private readonly evaluations: WeakMap<AnyNode, Evaluation>;
  private readonly valueSource: ValueSource;
  private currentDependencyCollector: DependencyCollector | undefined;
  private readonly readContext = {
    get: <Value>(dependency: Signal<Value>): Value => {
      const collector = this.currentDependencyCollector;
      const previous = collector?.previous?.[collector.index];
      const evaluation = this.readEvaluationInContext(
        dependency,
        previous?.node === dependency
          ? previous.candidates
          : undefined,
      );
      if (collector) {
        collector.dependencies.push(
          previous?.node === dependency &&
            Object.is(previous.revision, evaluation.revision)
            ? previous
            : {
                node: dependency as AnySignal,
                revision: evaluation.revision,
                candidates: evaluation.candidates,
              },
        );
        ++collector.index;
      }
      return returnResultValue(evaluation.result);
    },
  };

  constructor(
    private readonly store: StoreImpl,
    private readonly state: EvaluationState,
  ) {
    this.evaluations = state[internalEvaluations];
    this.valueSource = state[internalValues];
  }

  readResult<Value>(
    node: Signal<Value> | Observation<Value>,
  ): SignalResult<Value> {
    return this.readEvaluation(node).result;
  }

  readEvaluation<Value>(
    node: Signal<Value> | Observation<Value>,
  ): Evaluation<Value> {
    if (this.contextDepth) {
      return this.readEvaluationInContext(node);
    }
    if (isSignal(node) && isPrimitiveSignal(node)) {
      return this.readEvaluationInContext(node) as Evaluation<Value>;
    }
    ++this.contextDepth;
    try {
      return withReadContext(
        this.readContext,
        () => this.readEvaluationInContext(node),
      );
    } finally {
      --this.contextDepth;
    }
  }

  readFreshObservation<Value>(
    observation: Observation<Value>,
    previousDependencies: readonly DependencyRecord[] | undefined,
  ): {
    readonly result: SignalResult<Value>;
    readonly directDependencies: readonly DependencyRecord[];
  } {
    const directDependencies: DependencyRecord[] = [];
    const collector: DependencyCollector = {
      previous: previousDependencies,
      dependencies: directDependencies,
      index: 0,
    };
    const previousCollector = this.currentDependencyCollector;
    this.currentDependencyCollector = collector;
    ++this.contextDepth;

    let result: SignalResult<Value>;
    try {
      const value = withReadContext(
        this.readContext,
        () => observation.INTERNAL_read(),
      );
      result = { type: "value", value };
    } catch (error) {
      result = { type: "error", error };
    } finally {
      --this.contextDepth;
      this.currentDependencyCollector = previousCollector;
    }

    if (getObservationVersion(observation) !== undefined) {
      this.state.cache.set(
        observation,
        result as SignalResult<unknown>,
      );
    }
    return { result, directDependencies };
  }

  private readEvaluationInContext<Value>(
    node: Signal<Value> | Observation<Value>,
    candidates?: EvaluationCandidates,
  ): Evaluation<Value> {
    const cached = this.evaluations.get(node);
    const nodeIsSignal = isSignal(node);
    const currentObservationVersion = nodeIsSignal
      ? undefined
      : getObservationVersion(node as AnyObservation);
    if (
      cached &&
      (currentObservationVersion === undefined ||
        cached.observationVersion === currentObservationVersion)
    ) {
      return cached as Evaluation<Value>;
    }

    if (nodeIsSignal && isPrimitiveSignal(node)) {
      return this.readPrimitive(node as AnyPrimitiveSignal) as Evaluation<Value>;
    }

    const availableCandidates =
      candidates || this.store.getEvaluationCandidates(node);
    const reusable = this.findReusableEvaluation(
      availableCandidates,
      currentObservationVersion,
    );
    if (reusable) {
      this.storeEvaluation(node, reusable);
      return reusable as Evaluation<Value>;
    }

    return this.evaluate(
      node,
      currentObservationVersion,
      availableCandidates,
    ) as Evaluation<Value>;
  }

  private readPrimitive(signal: AnyPrimitiveSignal): Evaluation {
    const entry = this.valueSource.getEntry(getSignalId(signal));
    const value = entry ? entry.value : signal.init;
    const revision = entry || value;
    const result: SignalResult<unknown> = { type: "value", value };
    const evaluation: Evaluation = {
      result,
      revision,
      directDependencies: EMPTY_DIRECT_DEPENDENCIES,
    };
    this.evaluations.set(signal, evaluation);
    this.state.cache.set(signal, result);
    this.state.dependencies.set(signal, EMPTY_CHANGED_SIGNALS);
    return evaluation;
  }

  private findReusableEvaluation(
    candidates: EvaluationCandidates | undefined,
    observationVersion: number | undefined,
  ): Evaluation | undefined {
    if (!candidates) {
      return undefined;
    }
    const first = candidates.first;
    const second = candidates.second;
    const firstDependency = first?.directDependencies[0];
    if (
      first &&
      second &&
      first.observationVersion === observationVersion &&
      second.observationVersion === observationVersion &&
      first.directDependencies.length === 1 &&
      second.directDependencies.length === 1 &&
      firstDependency?.node === second.directDependencies[0].node &&
      this.state.changedSignals.has(firstDependency.node)
    ) {
      return undefined;
    }
    if (
      first &&
      first.observationVersion === observationVersion &&
      this.isEvaluationValid(first)
    ) {
      return first;
    }
    if (
      second &&
      second.observationVersion === observationVersion &&
      this.isEvaluationValid(second)
    ) {
      return second;
    }
    return undefined;
  }

  private isEvaluationValid(evaluation: Evaluation): boolean {
    for (const dependency of evaluation.directDependencies) {
      if (this.state.changedSignals.has(dependency.node)) {
        return false;
      }
      if (
        !Object.is(
          this.readEvaluationInContext(
            dependency.node,
            dependency.candidates,
          ).revision,
          dependency.revision,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private evaluate(
    node: AnyNode,
    currentObservationVersion: number | undefined,
    candidates: EvaluationCandidates | undefined,
  ): Evaluation {
    const first = candidates?.first;
    const second = candidates?.second;
    const firstCandidate =
      first?.observationVersion === currentObservationVersion
        ? first
        : undefined;
    const secondCandidate =
      second?.observationVersion === currentObservationVersion
        ? second
        : undefined;
    const previousDependencies = firstCandidate?.directDependencies;
    const directDependencies: DependencyRecord[] = [];
    const collector: DependencyCollector = {
      previous: previousDependencies,
      dependencies: directDependencies,
      index: 0,
    };

    let result: SignalResult<unknown>;
    const previousCollector = this.currentDependencyCollector;
    this.currentDependencyCollector = collector;
    try {
      const value = node.INTERNAL_read?.();
      result = { type: "value", value };
    } catch (error) {
      result = { type: "error", error };
    } finally {
      this.currentDependencyCollector = previousCollector;
    }

    let matchingPrevious: Evaluation | undefined;
    if (
      firstCandidate &&
      !INTERNAL_didResultChange(firstCandidate.result, result)
    ) {
      matchingPrevious = firstCandidate;
    } else if (
      secondCandidate &&
      !INTERNAL_didResultChange(secondCandidate.result, result)
    ) {
      matchingPrevious = secondCandidate;
    }

    const evaluation: Evaluation = {
      result: matchingPrevious?.result || result,
      revision: matchingPrevious?.revision || result,
      directDependencies,
      candidates,
    };
    if (currentObservationVersion !== undefined) {
      evaluation.observationVersion = currentObservationVersion;
    }
    this.storeEvaluation(node, evaluation);
    this.store.rememberEvaluation(node, evaluation, candidates);
    return evaluation;
  }

  private storeEvaluation(
    node: AnyNode,
    evaluation: Evaluation,
  ): void {
    this.evaluations.set(node, evaluation);
    this.state.cache.set(node, evaluation.result);
    const { directDependencies } = evaluation;
    if (!directDependencies.length) {
      this.state.dependencies.set(node, EMPTY_CHANGED_SIGNALS);
      return;
    }
    if (
      directDependencies.length === 1 &&
      isPrimitiveSignal(directDependencies[0].node)
    ) {
      this.state.dependencies.set(
        node,
        getPrimitiveDependencySet(
          directDependencies[0].node as AnyPrimitiveSignal,
        ),
      );
      return;
    }
    this.state.dependencies.set(
      node,
      new LazyDependencySet(() =>
        this.collectTransitiveDependencies(evaluation),
      ),
    );
  }

  collectTransitiveDependencies(
    root: Evaluation,
  ): Set<AnySignal> {
    const collected = new Set<AnySignal>();
    const stack: AnySignal[] = [];
    const rootDependencies = root.directDependencies;
    for (let index = rootDependencies.length - 1; index >= 0; --index) {
      stack.push(rootDependencies[index].node);
    }
    while (stack.length) {
      const dependency = stack.pop() as AnySignal;
      if (collected.has(dependency)) {
        continue;
      }
      collected.add(dependency);
      if (isPrimitiveSignal(dependency)) {
        continue;
      }
      const evaluation = this.readEvaluation(dependency);
      const { directDependencies } = evaluation;
      for (
        let index = directDependencies.length - 1;
        index >= 0;
        --index
      ) {
        stack.push(directDependencies[index].node);
      }
    }
    return collected;
  }
}

class WriteDraft implements ValueSource {
  private readonly changedSignals = new Set<AnySignal>();
  private readonly values: PersistentValuesDraft<AnySignal, unknown>;
  private evaluationState: EvaluationState | undefined;

  constructor(
    private readonly store: StoreImpl,
    private readonly snapshot: InternalSnapshot,
  ) {
    this.values = snapshot[internalValues].draft();
  }

  getEntry(id: number): ValueEntry | undefined {
    return this.values.getEntry(id);
  }

  run<Value, Args extends unknown[], Result>(
    signal: WritableSignal<Value, Args, Result>,
    args: readonly unknown[],
  ): Result {
    return this.writeSignal(signal as AnyWritableSignal, args) as Result;
  }

  finish(): {
    readonly snapshot: InternalSnapshot;
    readonly changed: boolean;
  } {
    if (!this.changedSignals.size) {
      return {
        snapshot: this.snapshot,
        changed: false,
      };
    }
    return {
      snapshot: createSnapshot(
        this.values.finish(),
        this.changedSignals,
      ),
      changed: true,
    };
  }

  private writeSignal(
    signal: AnyWritableSignal,
    args: readonly unknown[],
  ): unknown {
    if (isPrimitiveSignal(signal)) {
      return this.setPrimitive(signal, args);
    }
    if (!signal.INTERNAL_write) {
      throw Error();
    }
    return withWriteContext(
      {
        get: (dependency) => this.get(dependency),
        set: (target, targetArgs) => this.set(target, targetArgs),
        setPrimitive: (target, value) =>
          this.setPrimitiveValue(
            target as AnyPrimitiveSignal,
            value,
          ),
      },
      () => signal.INTERNAL_write?.(...args),
    );
  }

  private get<Value>(signal: Signal<Value>): Value {
    return returnResultValue(this.getReader().readResult(signal));
  }

  private getReader(): SnapshotReader {
    if (!this.evaluationState) {
      this.evaluationState = {
        [internalValues]: this,
        cache: new WeakMap(),
        changedSignals: this.changedSignals,
        dependencies: new WeakMap(),
        [internalEvaluations]: new WeakMap(),
      };
    }
    return new SnapshotReader(this.store, this.evaluationState);
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
    this.setPrimitiveValue(signal, args[0]);
  }

  private setPrimitiveValue(
    signal: AnyPrimitiveSignal,
    value: unknown,
  ): void {
    const id = getSignalId(signal);
    const entry = this.values.getEntry(id);
    const previous = entry ? entry.value : signal.init;
    const next =
      typeof value === "function"
        ? (value as (previous: unknown) => unknown)(previous)
        : value;
    if (Object.is(previous, next)) {
      return;
    }
    this.values.setEntry({
      id,
      key: signal,
      value: next,
    });
    this.changedSignals.add(signal);
    this.evaluationState = undefined;
  }
}

const foreignSnapshotStates = new WeakMap<Snapshot, EvaluationState>();
const foreignSnapshotValues = new WeakMap<
  Snapshot,
  PersistentValues<AnySignal, unknown>
>();

class StoreImpl implements Store {
  readonly concurrentStore: ConcurrentStore<Snapshot, SetAction>;
  private mountedSignals = new WeakMap<AnySignal, MountedSignal>();
  private evaluationCandidates: WeakMap<
    AnyNode,
    EvaluationCandidates
  > | undefined;
  private subscriptionsByDependency: WeakMap<
    AnyPrimitiveSignal,
    Set<AnySubscriptionRecord>
  > | undefined;
  private pendingSubscriptions: Set<AnySubscriptionRecord> | undefined;
  private hooks: ConcurrentStoreHooks<Snapshot> | undefined;
  private activeSubscriptionCount = 0;
  private notificationEpoch = 0;
  private notificationContext: NotificationContext | undefined;

  constructor() {
    this.concurrentStore = new ConcurrentStore<Snapshot, SetAction>(
      initialSnapshot(),
      (snapshot, action) => this.reduceAction(snapshot, action),
    );
  }

  run<Result>(fn: () => Result): Result {
    return withStoreScope(this, fn);
  }

  get<Value>(signal: Signal<Value>): Value {
    return this.getFromSnapshot(signal, this.concurrentStore.getState());
  }

  getFromSnapshot<Value>(signal: Signal<Value>, snapshot: Snapshot): Value {
    const cached = snapshot.cache.get(signal);
    return returnResultValue(
      (cached as SignalResult<Value> | undefined) ||
        ((isPrimitiveSignal(signal)
          ? this.readPrimitiveResult(signal, snapshot)
          : this.createReader(snapshot).readResult(signal)) as
          SignalResult<Value>),
    );
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
    const cached = snapshot.cache.get(node);
    if (cached) {
      if (isSignal(node)) {
        return cached as SignalResult<Value>;
      }
      const evaluation = this.getEvaluationState(snapshot)[
        internalEvaluations
      ].get(node);
      if (
        evaluation?.observationVersion ===
        getObservationVersion(node as AnyObservation)
      ) {
        return cached as SignalResult<Value>;
      }
    }
    if (isSignal(node) && isPrimitiveSignal(node)) {
      return this.readPrimitiveResult(
        node,
        snapshot,
      ) as SignalResult<Value>;
    }
    return this.createReader(snapshot).readResult(node);
  }

  set<Value, Args extends unknown[], Result>(
    signal: WritableSignal<Value, Args, Result>,
    ...args: Args
  ): Result {
    if (!isWritableSignal(signal)) {
      throw Error();
    }
    if (isPrimitiveSignal(signal)) {
      this.INTERNAL_setPrimitive(
        signal as AnyPrimitiveSignal,
        args[0],
      );
      return undefined as Result;
    }
    const action: SetAction = {
      kind: "derived",
      signal: signal as AnyWritableSignal,
      args,
    };
    const applied = this.applyAction(
      INTERNAL_getConcurrentStoreActionState(this.concurrentStore),
      action,
    );
    if (!applied.changed) {
      return applied.result as Result;
    }
    this.concurrentStore.dispatch(action, applied.snapshot);
    return applied.result as Result;
  }

  sub(node: AnyNode, listener: () => void): () => void {
    return this.INTERNAL_subscribe(
      node,
      listener as unknown as (
        event: INTERNAL_StoreSubscriptionEvent<unknown>,
      ) => void,
      false,
      false,
      0,
    );
  }

  subEffect<Value>(
    observation: Observation<Value>,
    listener: (result: SignalResult<Value>) => void,
  ): () => void {
    return this.INTERNAL_subscribe(
      observation,
      listener as unknown as (
        event: INTERNAL_StoreSubscriptionEvent<Value>,
      ) => void,
      true,
      true,
      0,
    );
  }

  INTERNAL_subscribe<Value>(
    node: Signal<Value> | Observation<Value>,
    listener: (event: INTERNAL_StoreSubscriptionEvent<Value>) => void,
    effect: boolean,
    resultOnly: boolean,
    refreshable: 0,
  ): () => void;
  INTERNAL_subscribe<Value>(
    node: Signal<Value> | Observation<Value>,
    listener: (event: INTERNAL_StoreSubscriptionEvent<Value>) => void,
    effect: boolean,
    resultOnly: boolean,
    refreshable: false,
  ): INTERNAL_BasicStoreSubscription<Value>;
  INTERNAL_subscribe<Value>(
    node: Signal<Value> | Observation<Value>,
    listener: (event: INTERNAL_StoreSubscriptionEvent<Value>) => void,
    effect?: boolean,
    resultOnly?: boolean,
    refreshable?: true,
  ): INTERNAL_StoreSubscription<Value>;
  INTERNAL_subscribe<Value>(
    node: Signal<Value> | Observation<Value>,
    listener: (event: INTERNAL_StoreSubscriptionEvent<Value>) => void,
    effect = false,
    resultOnly = false,
    refreshable: boolean | 0 = true,
  ):
    | (() => void)
    | INTERNAL_BasicStoreSubscription<Value>
    | INTERNAL_StoreSubscription<Value> {
    const headSnapshot = this.concurrentStore.getState();
    const committedSnapshot = this.concurrentStore.getCommittedState();
    const head = this.createSubscriptionState(
      node,
      headSnapshot,
      undefined,
      resultOnly,
    );
    const committed =
      committedSnapshot === headSnapshot
        ? head
        : this.createSubscriptionState(
            node,
            committedSnapshot,
            head,
            resultOnly,
          );
    const staticDependencies =
      isSignal(node) && isPrimitiveSignal(node);
    const record: SubscriptionRecord<Value> = {
      order:
        INTERNAL_registerEmitterVirtualListener<[NotificationPhase]>(
          this.concurrentStore,
        ),
      node,
      listener,
      effect,
      resultOnly,
      staticDependencies,
      active: true,
      initialized: false,
      queuedEpoch: 0,
      headSequence: this.notificationEpoch,
      committedSequence: this.notificationEpoch,
      dependencyVersion: 0,
      head,
      committed,
      indexedDependencies: EMPTY_DEPENDENCIES,
      mountedDependencies: EMPTY_DEPENDENCIES,
      mountedSignals: undefined,
    };
    const unsubscribe = () => {
      if (!record.active) {
        return;
      }
      record.active = false;
      INTERNAL_unregisterEmitterVirtualListener(this.concurrentStore);
      --this.activeSubscriptionCount;
      if (!this.activeSubscriptionCount) {
        INTERNAL_setConcurrentStoreHooks(this.concurrentStore, undefined);
      }
      this.pendingSubscriptions?.delete(record);
      for (const dependency of record.indexedDependencies) {
        this.subscriptionsByDependency
          ?.get(dependency)
          ?.delete(record);
      }
      if (record.staticDependencies) {
        this.unmountSignal(record.node as AnySignal);
      } else {
        for (const signal of
          record.mountedSignals || record.mountedDependencies) {
          this.unmountSignal(signal);
        }
      }
    };
    ++this.activeSubscriptionCount;
    if (this.activeSubscriptionCount === 1) {
      INTERNAL_setConcurrentStoreHooks(
        this.concurrentStore,
        (this.hooks ||= {
          change: (change) => this.handleChange(change),
          commit: (_previous, next) => this.handleCommit(next),
          rebase: (replay, current) =>
            createSnapshot(
              this.getInternalSnapshot(current)[internalValues],
              replay.changedSignals,
            ),
        }),
      );
    }
    if (headSnapshot !== committedSnapshot) {
      (this.pendingSubscriptions ||= new Set()).add(record);
    }
    this.reindexSubscription(record);
    try {
      if (record.staticDependencies) {
        this.retainSignal(record.node as AnySignal);
        record.mountedDependencies = record.head.all;
      } else {
        this.reconcileMountedSignals(record);
      }
      record.initialized = true;
    } catch (error) {
      unsubscribe();
      throw error;
    }

    if (refreshable === 0) {
      return unsubscribe;
    }
    const basic = {
      result: record.head.result,
      unsubscribe,
    };
    if (!refreshable) {
      return basic;
    }
    const finishRefresh = () => {
      if (record.active) {
        this.updatePendingSubscription(record);
        this.reindexSubscription(record);
        this.reconcileMountedSignals(record);
      }
    };
    return {
      ...basic,
      refresh: (snapshot, lane = "both") => {
        const next = this.createSubscriptionState(
          node,
          snapshot,
          lane === "sync" ? record.committed : record.head,
        );
        if (lane === "sync" || lane === "both") {
          record.committed = next;
        }
        if (lane === "transition" || lane === "both") {
          record.head = next;
        }
        ++record.dependencyVersion;
        finishRefresh();
        return next.result;
      },
      refreshFromRender: (snapshot, lane) => {
        const next = this.createSubscriptionState(
          node,
          snapshot,
          lane === "sync" ? record.committed : record.head,
        );
        if (lane === "sync") {
          record.committed = next;
          record.head =
            record.head.snapshot === snapshot
              ? next
              : this.createSubscriptionState(
                  node,
                  record.head.snapshot,
                  record.head,
                );
        } else {
          record.head = next;
          record.committed =
            record.committed.snapshot === snapshot
              ? next
              : this.createSubscriptionState(
                  node,
                  record.committed.snapshot,
                  record.committed,
                );
        }
        ++record.dependencyVersion;
        finishRefresh();
        return next.result;
      },
    };
  }

  mountSignal(signal: AnySignal): () => void {
    this.retainSignal(signal);
    return () => this.unmountSignal(signal);
  }

  private retainSignal(signal: AnySignal): void {
    const mounted = this.mountedSignals.get(signal);
    if (mounted) {
      ++mounted.count;
      return;
    }
    const nextMounted: MountedSignal = { count: 1 };
    this.mountedSignals.set(signal, nextMounted);
    signal.INTERNAL_onInit?.(this);
    if (isWritableSignal(signal) && signal.onMount) {
      const setSignal = (...args: unknown[]) => this.set(signal, ...args);
      const cleanup = signal.onMount(setSignal as never);
      if (cleanup) {
        if (this.mountedSignals.get(signal) === nextMounted) {
          nextMounted.unmount = cleanup;
        } else {
          cleanup();
        }
      }
    }
  }

  getSnapshot(): Snapshot {
    return this.concurrentStore.getState();
  }

  getCommittedSnapshot(): Snapshot {
    return this.concurrentStore.getCommittedState();
  }

  getEvaluationCandidates(
    signal: AnyNode,
  ): EvaluationCandidates | undefined {
    return this.evaluationCandidates?.get(signal);
  }

  rememberEvaluation(
    signal: AnyNode,
    evaluation: Evaluation,
    candidates: EvaluationCandidates | undefined,
  ): void {
    if (!candidates) {
      candidates = { first: evaluation };
      evaluation.candidates = candidates;
      (this.evaluationCandidates ||= new WeakMap()).set(signal, candidates);
      return;
    }
    evaluation.candidates = candidates;
    if (candidates.first === evaluation) {
      return;
    }
    candidates.second = candidates.first;
    candidates.first = evaluation;
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
    if (action.kind === "primitive") {
      return this.applyPrimitiveAction(
        snapshot,
        action.signal,
        action.value,
      );
    }
    const internalSnapshot = this.getInternalSnapshot(snapshot);
    const draft = new WriteDraft(this, internalSnapshot);
    const result = draft.run(action.signal, action.args);
    return { ...draft.finish(), result };
  }

  private applyPrimitiveAction(
    snapshot: Snapshot,
    signal: AnyPrimitiveSignal,
    value: unknown,
  ) {
    const internalSnapshot = this.getInternalSnapshot(snapshot);
    const values = internalSnapshot[internalValues];
    const id = getSignalId(signal);
    const entry = values.getEntry(id);
    const previous = entry ? entry.value : signal.init;
    const next =
      typeof value === "function"
        ? (value as (previous: unknown) => unknown)(previous)
        : value;
    if (Object.is(previous, next)) {
      return {
        snapshot: internalSnapshot,
        changed: false,
        result: undefined,
      };
    }
    return {
      snapshot: createSnapshot(
        values.set(id, signal, next),
        new Set([signal]),
      ),
      changed: true,
      result: undefined,
    };
  }

  private reduceAction(snapshot: Snapshot, action: SetAction): Snapshot {
    const applied = this.applyAction(snapshot, action);
    if (applied.changed) {
      return applied.snapshot;
    }
    return createSnapshot(
      this.getInternalSnapshot(snapshot)[internalValues],
      EMPTY_CHANGED_SIGNALS,
    );
  }

  private INTERNAL_setPrimitive(
    signal: AnyPrimitiveSignal,
    value: unknown,
  ): void {
    const applied = this.applyPrimitiveAction(
      INTERNAL_getConcurrentStoreActionState(this.concurrentStore),
      signal,
      value,
    );
    if (applied.changed) {
      this.concurrentStore.dispatch(
        { kind: "primitive", signal, value },
        applied.snapshot,
      );
    }
  }

  private getInternalSnapshot(snapshot: Snapshot): InternalSnapshot {
    if (internalValues in snapshot) {
      return snapshot as InternalSnapshot;
    }
    return createSnapshot(
      this.getSnapshotValues(snapshot),
      snapshot.changedSignals,
    );
  }

  private getEvaluationState(snapshot: Snapshot): EvaluationState {
    if (internalValues in snapshot) {
      return snapshot as InternalSnapshot;
    }
    let state = foreignSnapshotStates.get(snapshot);
    if (!state) {
      state = {
        [internalValues]: this.getSnapshotValues(snapshot),
        cache: snapshot.cache,
        changedSignals: snapshot.changedSignals,
        dependencies: snapshot.dependencies,
        [internalEvaluations]: new WeakMap(),
      };
      foreignSnapshotStates.set(snapshot, state);
    }
    return state;
  }

  private getSnapshotValues(
    snapshot: Snapshot,
  ): PersistentValues<AnySignal, unknown> {
    if (internalValues in snapshot) {
      return (snapshot as InternalSnapshot)[internalValues];
    }
    let values = foreignSnapshotValues.get(snapshot);
    if (!values) {
      const draft =
        PersistentValues.empty<AnySignal, unknown>().draft();
      for (const [signal, value] of snapshot.values) {
        draft.setEntry({
          id: getSignalId(signal),
          key: signal,
          value,
        });
      }
      values = draft.finish();
      foreignSnapshotValues.set(snapshot, values);
    }
    return values;
  }

  private createReader(snapshot: Snapshot): SnapshotReader {
    return new SnapshotReader(this, this.getEvaluationState(snapshot));
  }

  private getNotificationReader(
    snapshot: Snapshot,
    readers: NotificationReaders,
  ): SnapshotReader {
    if (snapshot === readers.previousSnapshot) {
      return (
        readers.previousReader ||=
          this.createReader(snapshot)
      );
    }
    if (snapshot === readers.nextSnapshot) {
      return (
        readers.nextReader ||=
          this.createReader(snapshot)
      );
    }
    return this.createReader(snapshot);
  }

  private createSubscriptionState<Value>(
    node: Signal<Value> | Observation<Value>,
    snapshot: Snapshot,
    previous?: SubscriptionState<Value>,
    fresh = false,
    readers?: NotificationReaders,
  ): SubscriptionState<Value> {
    if (isSignal(node) && isPrimitiveSignal(node)) {
      const dependencies =
        previous?.primitives ||
        getPrimitiveDependencySet(node as AnyPrimitiveSignal);
      const result = this.readPrimitiveResult(
        node,
        snapshot,
      ) as SignalResult<Value>;
      return {
        snapshot,
        result,
        directDependencies: EMPTY_DIRECT_DEPENDENCIES,
        all: dependencies,
        primitives: dependencies,
      };
    }
    const reader = readers
      ? this.getNotificationReader(snapshot, readers)
      : this.createReader(snapshot);
    let result: SignalResult<Value>;
    let directDependencies: readonly DependencyRecord[];
    if (fresh && !isSignal(node)) {
      const freshEvaluation = reader.readFreshObservation(
        node as AnyObservation,
        previous?.directDependencies,
      );
      result = freshEvaluation.result as SignalResult<Value>;
      directDependencies = freshEvaluation.directDependencies;
    } else {
      const evaluation = reader.readEvaluation(node);
      result = evaluation.result as SignalResult<Value>;
      directDependencies = evaluation.directDependencies;
    }
    if (!isSignal(node)) {
      let directPrimitives = true;
      let samePrimitiveTopology =
        previous?.directDependencies.length ===
        directDependencies.length;
      for (let index = 0; index < directDependencies.length; ++index) {
        const dependency = directDependencies[index];
        if (!isPrimitiveSignal(dependency.node)) {
          directPrimitives = false;
          break;
        }
        if (
          samePrimitiveTopology &&
          previous?.directDependencies[index]?.node !== dependency.node
        ) {
          samePrimitiveTopology = false;
        }
      }
      if (directPrimitives) {
        const primitives = samePrimitiveTopology
          ? (previous as SubscriptionState<Value>).primitives
          : directDependencies.length === 0
            ? EMPTY_DEPENDENCIES
            : directDependencies.length === 1
              ? getPrimitiveDependencySet(
                  directDependencies[0].node as AnyPrimitiveSignal,
                )
              : new Set(
                  directDependencies.map(
                    (dependency) =>
                      dependency.node as AnyPrimitiveSignal,
                  ),
                );
        const all = samePrimitiveTopology
          ? (previous as SubscriptionState<Value>).all
          : primitives;
        if (
          getObservationVersion(node as AnyObservation) !==
          undefined
        ) {
          snapshot.dependencies.set(node, all);
        }
        return {
          snapshot,
          result,
          directDependencies,
          all,
          primitives,
        };
      }
    }
    const all = new Set<AnySignal>();
    const primitives = new Set<AnyPrimitiveSignal>();
    const stack: AnySignal[] = [];
    if (isSignal(node)) {
      stack.push(node as AnySignal);
    } else {
      for (
        let index = directDependencies.length - 1;
        index >= 0;
        --index
      ) {
        stack.push(directDependencies[index].node);
      }
    }
    while (stack.length) {
      const dependency = stack.pop() as AnySignal;
      if (all.has(dependency)) {
        continue;
      }
      all.add(dependency);
      if (isPrimitiveSignal(dependency)) {
        primitives.add(dependency);
        continue;
      }
      const dependencyEvaluation = reader.readEvaluation(dependency);
      const dependencyDirectDependencies =
        dependencyEvaluation.directDependencies;
      for (
        let index = dependencyDirectDependencies.length - 1;
        index >= 0;
        --index
      ) {
        stack.push(dependencyDirectDependencies[index].node);
      }
    }
    const stableAll =
      previous && haveSameSetMembers(previous.all, all)
        ? previous.all
        : all;
    const stablePrimitives =
      previous &&
      haveSameSetMembers(previous.primitives, primitives)
        ? previous.primitives
        : primitives;
    if (
      !isSignal(node) &&
      getObservationVersion(node as AnyObservation) !== undefined
    ) {
      snapshot.dependencies.set(node, stableAll);
    }
    return {
      snapshot,
      result,
      directDependencies,
      all: stableAll,
      primitives: stablePrimitives,
    };
  }

  private readPrimitiveResult(
    signal: AnyPrimitiveSignal,
    snapshot: Snapshot,
  ): SignalResult<unknown> {
    const cached = snapshot.cache.get(signal);
    if (cached) {
      return cached;
    }
    const entry = this.getSnapshotValues(snapshot).getEntry(
      getSignalId(signal),
    );
    const result: SignalResult<unknown> = {
      type: "value",
      value: entry ? entry.value : signal.init,
    };
    snapshot.cache.set(signal, result);
    snapshot.dependencies.set(signal, EMPTY_CHANGED_SIGNALS);
    return result;
  }

  private handleChange(change: ConcurrentStoreChange<Snapshot>): void {
    if (
      !this.activeSubscriptionCount ||
      !change.next.changedSignals.size
    ) {
      this.concurrentStore.notify(change.phase);
      return;
    }
    const epoch = ++this.notificationEpoch;
    const candidates: AnySubscriptionRecord[] = [];
    const needsDeduplication =
      change.next.changedSignals.size > 1;
    const updatesBothLanes =
      change.updatesHead && change.updatesCommitted;
    let candidatesAreOrdered = true;
    let lastCandidateOrder = 0;
    for (const changedSignal of change.next.changedSignals) {
      if (!isPrimitiveSignal(changedSignal)) {
        continue;
      }
      const bucket =
        this.subscriptionsByDependency?.get(changedSignal);
      if (!bucket) {
        continue;
      }
      for (const record of bucket) {
        if (
          (!needsDeduplication ||
            record.queuedEpoch !== epoch) &&
          (updatesBothLanes ||
            (change.updatesHead &&
            record.head.primitives.has(changedSignal)) ||
            (change.updatesCommitted &&
              record.committed.primitives.has(changedSignal)))
        ) {
          if (needsDeduplication) {
            record.queuedEpoch = epoch;
          }
          if (record.order < lastCandidateOrder) {
            candidatesAreOrdered = false;
          }
          lastCandidateOrder = record.order;
          candidates.push(record);
        }
      }
    }
    if (!candidatesAreOrdered) {
      candidates.sort((left, right) => left.order - right.order);
    }
    if (!candidates.length) {
      this.concurrentStore.notify(change.phase);
      return;
    }
    const shareStates =
      candidates.length > 1 &&
      candidates[0].node === candidates[1].node;
    const nextStates = shareStates ? new WeakMap() : undefined;
    const readers: NotificationReaders = {
      previousSnapshot: change.previous,
      nextSnapshot: change.next,
    };
    if (!INTERNAL_hasEmitterListeners(this.concurrentStore)) {
      for (const record of candidates) {
        this.deliverChange(
          record,
          change,
          epoch,
          nextStates,
          readers,
        );
      }
      return;
    }
    const context: NotificationContext = {
      change,
      epoch,
      nextStates,
      readers,
      parent: this.notificationContext,
    };
    this.notificationContext = context;
    try {
      INTERNAL_notifyEmitterSelected(
        this.concurrentStore,
        candidates,
        (record, _phase) => this.deliverPreparedChange(record),
        change.phase,
      );
    } finally {
      if (this.notificationContext === context) {
        this.notificationContext = context.parent;
      }
    }
  }

  private deliverPreparedChange<Value>(
    record: SubscriptionRecord<Value>,
  ): void {
    const context = this.notificationContext;
    if (!context) {
      return;
    }
    this.deliverChange(
      record,
      context.change,
      context.epoch,
      context.nextStates,
      context.readers,
    );
  }

  private deliverChange<Value>(
    record: SubscriptionRecord<Value>,
    change: ConcurrentStoreChange<Snapshot>,
    epoch: number,
    nextStates:
      | WeakMap<AnyNode, SubscriptionState>
      | undefined,
    readers: NotificationReaders,
  ): void {
    const lanePrevious =
      record.head.snapshot === change.previous
        ? record.head
        : record.committed.snapshot === change.previous
          ? record.committed
          : undefined;
    const previous =
      lanePrevious
        ? lanePrevious
        : this.createSubscriptionState(
            record.node,
            change.previous,
            undefined,
            false,
            readers,
          );
    const next = this.getCachedSubscriptionState(
      record.node,
      change.next,
      nextStates,
      change.updatesHead ? record.head : record.committed,
      record.effect,
      readers,
    );
    let stateChanged = false;
    if (record.active) {
      if (change.updatesHead && record.headSequence < epoch) {
        record.head = next;
        record.headSequence = epoch;
        stateChanged = true;
      }
      if (
        change.updatesCommitted &&
        record.committedSequence < epoch
      ) {
        record.committed = next;
        record.committedSequence = epoch;
        stateChanged = true;
      }
      if (stateChanged) {
        ++record.dependencyVersion;
        if (
          record.head.snapshot !== record.committed.snapshot ||
          this.pendingSubscriptions?.has(record)
        ) {
          this.updatePendingSubscription(record);
        }
      }
      if (stateChanged && !record.staticDependencies) {
        if (
          record.head.primitives !== record.committed.primitives ||
          record.indexedDependencies !== record.head.primitives
        ) {
          this.reindexSubscription(record);
        }
        if (
          record.head.all !== record.committed.all ||
          record.mountedDependencies !== record.head.all
        ) {
          this.reconcileMountedSignals(record);
        }
      }
    }

    if (!record.initialized) {
      return;
    }
    if (record.resultOnly) {
      (
        record.listener as unknown as (
          result: SignalResult<Value>,
        ) => void
      )(next.result);
    } else if (
      record.effect ||
      INTERNAL_didResultChange(previous.result, next.result)
    ) {
      record.listener({
        sequence: epoch,
        phase: change.phase,
        snapshot: change.next,
        result: next.result,
        previousSnapshot: change.previous,
      });
    }
  }

  private handleCommit(snapshot: Snapshot): void {
    if (!this.pendingSubscriptions?.size) {
      return;
    }
    const pending = Array.from(this.pendingSubscriptions);
    this.pendingSubscriptions.clear();
    for (const record of pending) {
      if (!record.active) {
        continue;
      }
      record.committed =
        record.head.snapshot === snapshot
          ? record.head
          : this.createSubscriptionState(
              record.node,
              snapshot,
              record.committed,
            );
      record.committedSequence = this.notificationEpoch;
      ++record.dependencyVersion;
      this.updatePendingSubscription(record);
      if (!record.staticDependencies) {
        this.reindexSubscription(record);
        this.reconcileMountedSignals(record);
      }
    }
  }

  private updatePendingSubscription(
    record: AnySubscriptionRecord,
  ): void {
    if (record.head.snapshot === record.committed.snapshot) {
      this.pendingSubscriptions?.delete(record);
    } else {
      (this.pendingSubscriptions ||= new Set()).add(record);
    }
  }

  private getCachedSubscriptionState<Value>(
    node: Signal<Value> | Observation<Value>,
    snapshot: Snapshot,
    states: WeakMap<AnyNode, SubscriptionState> | undefined,
    previous?: SubscriptionState<Value>,
    fresh = false,
    readers?: NotificationReaders,
  ): SubscriptionState<Value> {
    const cached = states?.get(node);
    if (cached) {
      return cached as SubscriptionState<Value>;
    }
    const state = this.createSubscriptionState(
      node,
      snapshot,
      previous,
      fresh,
      readers,
    );
    states?.set(node, state as SubscriptionState);
    return state;
  }

  private reindexSubscription(record: AnySubscriptionRecord): void {
    let nextDependencies: ReadonlySet<AnyPrimitiveSignal>;
    if (record.head.primitives === record.committed.primitives) {
      nextDependencies = record.head.primitives;
    } else {
      const union = new Set<AnyPrimitiveSignal>(record.head.primitives);
      for (const dependency of record.committed.primitives) {
        union.add(dependency);
      }
      nextDependencies = union;
    }
    if (record.indexedDependencies === nextDependencies) {
      return;
    }

    for (const dependency of record.indexedDependencies) {
      if (!nextDependencies.has(dependency)) {
        this.subscriptionsByDependency
          ?.get(dependency)
          ?.delete(record);
      }
    }
    for (const dependency of nextDependencies) {
      if (!record.indexedDependencies.has(dependency)) {
        const subscriptionsByDependency =
          (this.subscriptionsByDependency ||= new WeakMap());
        let bucket = subscriptionsByDependency.get(dependency);
        if (!bucket) {
          bucket = new Set();
          subscriptionsByDependency.set(dependency, bucket);
        }
        bucket.add(record);
      }
    }
    record.indexedDependencies = nextDependencies;
  }

  private reconcileMountedSignals(record: AnySubscriptionRecord): void {
    const dependencyVersion = record.dependencyVersion;
    let nextSignals: ReadonlySet<AnySignal>;
    if (record.head.all === record.committed.all) {
      nextSignals = record.head.all;
    } else {
      const union = new Set<AnySignal>(record.head.all);
      for (const signal of record.committed.all) {
        union.add(signal);
      }
      nextSignals = union;
    }
    if (record.mountedDependencies === nextSignals) {
      return;
    }
    if (
      !record.mountedSignals &&
      !record.mountedDependencies.size &&
      nextSignals.size === 1
    ) {
      record.mountedDependencies = nextSignals;
      this.retainSignal(
        nextSignals.values()["next"]().value as AnySignal,
      );
      return;
    }
    const mountedSignals =
      record.mountedSignals ||
      (record.mountedSignals = new Set(record.mountedDependencies));
    for (const signal of mountedSignals) {
      if (!nextSignals.has(signal)) {
        mountedSignals.delete(signal);
        this.unmountSignal(signal);
        if (record.dependencyVersion !== dependencyVersion) {
          return;
        }
      }
    }
    for (const signal of nextSignals) {
      if (!mountedSignals.has(signal)) {
        mountedSignals.add(signal);
        this.retainSignal(signal);
        if (record.dependencyVersion !== dependencyVersion) {
          return;
        }
      }
    }
    record.mountedDependencies = nextSignals;
  }
}

let defaultStore: Store | undefined;

export function createStore(): Store {
  return new StoreImpl();
}

export function getDefaultStore(): Store {
  defaultStore ||= createStore();
  return defaultStore;
}

setDefaultStoreGetter(getDefaultStore);

export function INTERNAL_subscribeStore<Value>(
  store: Store,
  node: Signal<Value> | Observation<Value>,
  listener: (event: INTERNAL_StoreSubscriptionEvent<Value>) => void,
  effect = false,
): INTERNAL_StoreSubscription<Value> {
  return (store as StoreImpl).INTERNAL_subscribe(
    node,
    listener,
    effect,
  );
}

export function INTERNAL_subscribeEffect<Value>(
  store: Store,
  observation: Observation<Value>,
  listener: (result: SignalResult<Value>) => void,
): INTERNAL_BasicStoreSubscription<Value> {
  return (store as StoreImpl).INTERNAL_subscribe(
    observation,
    listener as unknown as (
      event: INTERNAL_StoreSubscriptionEvent<Value>,
    ) => void,
    true,
    true,
    false,
  );
}

export function effect(read: () => unknown, write: () => void): () => void {
  const store = getActiveStore() as Store;
  const observation = { INTERNAL_read: read } as Observation<unknown>;
  const runWrite = (result: SignalResult<unknown>) => {
    returnResultValue(result);
    store.run(write);
  };
  const subscription = INTERNAL_subscribeEffect(
    store,
    observation,
    runWrite,
  );
  runWrite(subscription.result);
  return subscription.unsubscribe;
}

export function when(read: () => boolean, write: () => void): () => void {
  const store = getActiveStore() as Store;
  const observation = { INTERNAL_read: read } as Observation<boolean>;
  const runWriteWhenTrue = (result: SignalResult<boolean>) => {
    if (returnResultValue(result)) {
      store.run(write);
    }
  };
  const subscription = INTERNAL_subscribeEffect(
    store,
    observation,
    runWriteWhenTrue,
  );
  runWriteWhenTrue(subscription.result);
  return subscription.unsubscribe;
}

export { signal };
