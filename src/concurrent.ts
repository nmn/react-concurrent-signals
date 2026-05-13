import * as React from "react";
import { startTransition } from "react";
import { Emitter } from "./emitter";

type ReactInternals = {
  T?: unknown;
};

const sharedReactInternals = React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?:
      | ReactInternals
      | undefined;
  };

const reactInternals =
  sharedReactInternals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function reactTransitionIsActive() {
  return !!reactInternals?.T;
}

export type Reducer<State, Action> = (state: State, action: Action) => State;
export type NotificationPhase = "sync" | "transition";

export class ConcurrentStore<State, Action> extends Emitter<[NotificationPhase]> {
  private state: State;
  private committedState: State;
  private reducer: Reducer<State, Action>;

  constructor(initialState: State, reducer: Reducer<State, Action>) {
    super();
    this.state = initialState;
    this.committedState = initialState;
    this.reducer = reducer;
  }

  commit(state: State) {
    this.committedState = state;
  }

  getCommittedState(): State {
    return this.committedState;
  }

  getState(): State {
    return this.state;
  }

  dispatch(action: Action, nextState: State) {
    const noPendingTransitions = this.committedState === this.state;
    this.state = nextState;

    if (reactTransitionIsActive()) {
      this.notify("transition");
      return;
    }

    if (noPendingTransitions) {
      this.committedState = this.state;
      this.notify("sync");
      return;
    }

    const pendingState = this.state;
    this.committedState = this.reducer(this.committedState, action);
    this.state = this.committedState;
    this.notify("sync");
    this.state = pendingState;
    startTransition(() => {
      this.notify("transition");
    });
  }
}

type RefCountedSubscription = {
  count: number;
  unsubscribe: () => void;
};

type StoreSnapshot = Map<ConcurrentStore<unknown, unknown>, unknown>;

export class StoreManager extends Emitter<[]> {
  private storeRefCounts = new Map<
    ConcurrentStore<unknown, unknown>,
    RefCountedSubscription
  >();

  addStore(store: ConcurrentStore<unknown, unknown>) {
    const prev = this.storeRefCounts.get(store);
    if (!prev) {
      this.storeRefCounts.set(store, {
        count: 1,
        unsubscribe: store.subscribe(() => this.notify()),
      });
      return;
    }
    this.storeRefCounts.set(store, { ...prev, count: prev.count + 1 });
  }

  removeStore(store: ConcurrentStore<unknown, unknown>) {
    const prev = this.storeRefCounts.get(store);
    if (!prev) {
      throw new Error("Concurrent store reference count imbalance");
    }
    this.storeRefCounts.set(store, { ...prev, count: prev.count - 1 });
  }

  getAllStates(): StoreSnapshot {
    return new Map(
      Array.from(this.storeRefCounts.keys()).map((store) => [
        store,
        store.getState(),
      ]),
    );
  }

  getAllCommittedStates(): StoreSnapshot {
    return new Map(
      Array.from(this.storeRefCounts.keys()).map((store) => [
        store,
        store.getCommittedState(),
      ]),
    );
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
