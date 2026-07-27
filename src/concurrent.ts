import { Emitter } from "./emitter";

export type Reducer<State, Action> = (state: State, action: Action) => State;
export type NotificationPhase = "sync" | "transition";

export type ConcurrentStoreChange<State> = {
  readonly phase: NotificationPhase;
  readonly previous: State;
  readonly next: State;
  readonly updatesHead: boolean;
  readonly updatesCommitted: boolean;
};

export type ConcurrentStoreHooks<State> = {
  readonly change: (change: ConcurrentStoreChange<State>) => void;
  readonly commit: (previous: State, next: State) => void;
  readonly rebase: (replay: State, current: State) => State;
};

type TransitionScheduler = {
  readonly isActive: () => boolean;
  readonly start: (callback: () => void) => void;
};

let transitionScheduler: TransitionScheduler = {
  isActive: () => false,
  start: (callback) => callback(),
};

type ActionContext = {
  readonly store: object;
  state: unknown;
  readonly parent: ActionContext | undefined;
};

let currentActionContext: ActionContext | undefined;

export function INTERNAL_setTransitionScheduler(
  scheduler: TransitionScheduler,
): void {
  transitionScheduler = scheduler;
}

export function INTERNAL_setConcurrentStoreHooks<State, Action>(
  store: ConcurrentStore<State, Action>,
  hooks: ConcurrentStoreHooks<State> | undefined,
): void {
  (
    store as unknown as {
      hooks?: ConcurrentStoreHooks<State>;
    }
  ).hooks = hooks;
}

export function INTERNAL_getConcurrentStoreActionState<State, Action>(
  store: ConcurrentStore<State, Action>,
): State {
  let context = currentActionContext;
  while (context) {
    if (context.store === store) {
      return context.state as State;
    }
    context = context.parent;
  }
  return store.getState();
}

export class ConcurrentStore<State, Action> extends Emitter<[NotificationPhase]> {
  private state: State;
  private committedState: State;
  private reducer: Reducer<State, Action>;
  private hooks: ConcurrentStoreHooks<State> | undefined;
  private rebaseFrame:
    | {
    state: State;
    changes: { previous: State; next: State }[];
    context: ActionContext;
      }
    | undefined;

  constructor(initialState: State, reducer: Reducer<State, Action>) {
    super();
    this.state = initialState;
    this.committedState = initialState;
    this.reducer = reducer;
  }

  commit(state: State) {
    const previous = this.committedState;
    this.committedState = state;
    if (previous !== state) {
      this.hooks?.commit(previous, state);
    }
  }

  getCommittedState(): State {
    return this.committedState;
  }

  getState(): State {
    return this.state;
  }

  dispatch(action: Action, nextState: State) {
    const transitionIsActive = transitionScheduler.isActive();
    const activeRebase = this.rebaseFrame;
    if (activeRebase) {
      const previousPending = activeRebase.state;
      const nextCommitted = transitionIsActive
        ? undefined
        : this.reducer(this.committedState, action);
      activeRebase.state = nextState;
      activeRebase.context.state = nextState;
      if (transitionIsActive) {
        this.state = nextState;
        this.emitChange({
          phase: "transition",
          previous: previousPending,
          next: nextState,
          updatesHead: true,
          updatesCommitted: false,
        });
        return;
      }
      activeRebase.changes.push({
        previous: previousPending,
        next: nextState,
      });
      const previousCommitted = this.committedState;
      this.state = nextCommitted as State;
      this.committedState = nextCommitted as State;
      this.emitChange({
        phase: "sync",
        previous: previousCommitted,
        next: nextCommitted as State,
        updatesHead: false,
        updatesCommitted: true,
      });
      return;
    }

    const previousHead = this.state;
    const previousCommitted = this.committedState;
    const noPendingTransitions = previousCommitted === previousHead;

    if (noPendingTransitions && !this.hooks) {
      this.state = nextState;
      if (transitionIsActive) {
        this.notify("transition");
      } else {
        this.committedState = nextState;
        this.notify("sync");
      }
      return;
    }

    if (transitionIsActive) {
      this.state = nextState;
      this.emitChange({
        phase: "transition",
        previous: previousHead,
        next: nextState,
        updatesHead: true,
        updatesCommitted: false,
      });
      return;
    }

    if (noPendingTransitions) {
      this.state = nextState;
      this.committedState = nextState;
      this.emitChange({
        phase: "sync",
        previous: previousCommitted,
        next: nextState,
        updatesHead: true,
        updatesCommitted: true,
      });
      return;
    }

    const pendingState = nextState;
    const nextCommittedState = this.reducer(previousCommitted, action);
    this.committedState = nextCommittedState;
    this.state = nextCommittedState;
    const context: ActionContext = {
      store: this,
      state: pendingState,
      parent: currentActionContext,
    };
    const rebaseFrame = {
      state: pendingState,
      changes: [{ previous: previousHead, next: pendingState }],
      context,
    };
    const previousRebaseFrame = this.rebaseFrame;
    this.rebaseFrame = rebaseFrame;
    currentActionContext = context;
    try {
      this.emitChange({
        phase: "sync",
        previous: previousCommitted,
        next: nextCommittedState,
        updatesHead: false,
        updatesCommitted: true,
      });
    } finally {
      this.rebaseFrame = previousRebaseFrame;
      this.state = rebaseFrame.state;
      currentActionContext = context.parent;
    }
    transitionScheduler.start(() => {
      for (const change of rebaseFrame.changes) {
        const rebase = this.hooks?.rebase;
        const replayState = rebase
          ? rebase(change.next, rebaseFrame.state)
          : change.next;
        if (rebase) {
          rebaseFrame.state = replayState;
          this.state = replayState;
        }
        this.emitChange({
          phase: "transition",
          previous: change.previous,
          next: replayState,
          updatesHead: true,
          updatesCommitted: false,
        });
      }
    });
  }

  private emitChange(change: ConcurrentStoreChange<State>) {
    if (this.hooks) {
      this.hooks.change(change);
    } else {
      this.notify(change.phase);
    }
  }
}

type RefCountedSubscription = {
  count: number;
  unsubscribe: () => void;
};

export type StoreSnapshot = Map<ConcurrentStore<unknown, unknown>, unknown>;

export class StoreManager extends Emitter<[]> {
  private storeRefCounts = new Map<
    ConcurrentStore<unknown, unknown>,
    RefCountedSubscription
  >();
  private fallbackTrackers = new Set<(states: StoreSnapshot) => void>();

  addStore(store: ConcurrentStore<unknown, unknown>) {
    const prev = this.storeRefCounts.get(store);
    if (!prev) {
      this.storeRefCounts.set(store, {
        count: 1,
        unsubscribe: store.subscribe((phase) =>
          this.notifyTrackers(phase === "sync"),
        ),
      });
      if (store.getState() !== store.getCommittedState()) {
        transitionScheduler.start(() => this.notifyTrackers());
      }
      return;
    }
    ++prev.count;
  }

  removeStore(store: ConcurrentStore<unknown, unknown>) {
    const prev = this.storeRefCounts.get(store);
    if (!prev) {
      throw Error();
    }
    --prev.count;
  }

  addFallbackTracker(
    listener: (states: StoreSnapshot) => void,
  ): () => void {
    this.fallbackTrackers.add(listener);
    return () => this.fallbackTrackers.delete(listener);
  }

  private notifyTrackers(committed?: boolean): void {
    const states = this.getAllStates(committed);
    this.notify();
    this.fallbackTrackers.values()["next"]().value?.(states);
  }

  getAllStates(committed?: boolean): StoreSnapshot {
    const states: StoreSnapshot = new Map();
    for (const [store] of this.storeRefCounts) {
      states.set(
        store,
        committed ? store.getCommittedState() : store.getState(),
      );
    }
    return states;
  }

  getAllCommittedStates(): StoreSnapshot {
    return this.getAllStates(true);
  }

  commitAllStates(states: StoreSnapshot) {
    for (const [store, state] of states) {
      store.commit(state);
    }
    this.sweep();
  }

  sweep() {
    for (const [store, refs] of this.storeRefCounts) {
      if (refs.count < 1) {
        refs.unsubscribe();
        this.storeRefCounts.delete(store);
      }
    }
  }
}
