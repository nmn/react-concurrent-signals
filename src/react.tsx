import * as React from "react";
import {
  createContext,
  createElement,
  memo,
  startTransition,
  useContext,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import {
  INTERNAL_setTransitionScheduler,
  StoreManager,
  type NotificationPhase,
  type StoreSnapshot,
} from "./concurrent";
import {
  bumpObservationVersion,
  createObservation,
} from "./signal";
import {
  INTERNAL_didResultChange,
  INTERNAL_subscribeStore,
  createStore,
  getDefaultStore,
  type INTERNAL_StoreSubscription,
  type SignalResult,
  type Snapshot,
  type Store,
} from "./store";

type ReactInternals = {
  H?: {
    useInsertionEffect?: unknown;
    useLayoutEffect?: unknown;
  };
  T?: unknown;
};

const sharedReactInternals = React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?:
    | ReactInternals
    | undefined;
};
const reactInternals =
  sharedReactInternals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

INTERNAL_setTransitionScheduler({
  isActive: () => !!reactInternals?.T,
  start: startTransition,
});

type Options = {
  "store"?: Store;
};

const defaultStoreManager = new StoreManager();
type StoreContextValue = readonly [Store | undefined, StoreManager];
const StoreContext = createContext<StoreContextValue>([
  undefined,
  defaultStoreManager,
]);

const usePromise = React.use as <T>(usable: PromiseLike<T>) => T;

const CommitTracker = memo(({ manager }: { manager: StoreManager }) => {
  const [allStates, setAllStates] = useState(() =>
    manager.getAllCommittedStates(),
  );

  useLayoutEffect(() => {
    const unsubscribe = manager.addFallbackTracker(setAllStates);
    return () => {
      unsubscribe();
      manager.sweep();
    };
  }, [manager]);

  useLayoutEffect(() => {
    manager.commitAllStates(allStates);
  }, [manager, allStates]);

  return null;
});

export function useStore(options?: Options): Store {
  const context = useContext(StoreContext);
  return options?.["store"] || context[0] || getDefaultStore();
}

type ProviderCell = [Store, StoreManager, StoreContextValue];

export function Provider(props: {
  "children"?: ReactNode;
  "store"?: Store;
}): ReactElement {
  const store = props["store"];
  const cellRef = useRef<ProviderCell | null>(null);
  if (!cellRef.current) {
    const base = store || createStore();
    const manager = new StoreManager();
    cellRef.current = [base, manager, [base, manager]];
  }

  const cell = cellRef.current;
  const scopedStore = store || cell[0];
  if (cell[2][0] !== scopedStore) {
    cell[2] = [scopedStore, cell[1]];
  }
  return createElement(
    StoreContext.Provider,
    { value: cell[2] },
    createElement(CommitTracker, { manager: cell[1] }),
    props["children"],
  );
}

type ObserveState<Value> = {
  store: Store;
  snapshot: Snapshot;
  phase: NotificationPhase;
  sequence: number;
  result: SignalResult<Value>;
  managerStates?: StoreSnapshot;
};

type ObserverCell<Value> = ReturnType<typeof createObservation<Value>> & {
  scratch?: ReturnType<typeof createObservation<Value>>;
  subscription: INTERNAL_StoreSubscription<Value> | null;
};

function readObserveState<Value>(
  store: Store,
  observation: ReturnType<typeof createObservation<Value>>,
): ObserveState<Value> {
  const snapshot = store.getSnapshot();
  return {
    store,
    snapshot,
    phase:
      snapshot === store.getCommittedSnapshot() ? "sync" : "transition",
    sequence: 0,
    result: store.readResultFromSnapshot(observation, snapshot),
  };
}

function useObservationResult<Value>(read: () => Value, options?: Options) {
  const context = useContext(StoreContext);
  const store = options?.["store"] || context[0] || getDefaultStore();
  const dispatcher = reactInternals?.H;
  // React's server dispatcher aliases these effects to the same no-op. There
  // is no lifecycle to retain there, while hydration uses the client
  // dispatcher and follows the complete subscription path below.
  if (
    dispatcher &&
    dispatcher.useInsertionEffect === dispatcher.useLayoutEffect
  ) {
    return store.readResultFromSnapshot(
      createObservation(read),
      store.getSnapshot(),
    );
  }
  const manager = context[1];

  const cellRef = useRef<ObserverCell<Value> | null>(null);
  if (!cellRef.current) {
    const cell = createObservation(read) as ObserverCell<Value>;
    cell.subscription = null;
    cellRef.current = cell;
  }
  const cell = cellRef.current;
  const observation = cell;
  const renderObservation =
    read === observation.INTERNAL_read
      ? observation
      : (cell.scratch ||= createObservation(read));
  if (renderObservation !== observation) {
    renderObservation.INTERNAL_read = read;
    bumpObservationVersion(renderObservation);
  }

  let initialState: ObserveState<Value> | undefined;
  const [state, setState] = useState<ObserveState<Value>>(
    () => (initialState = readObserveState(store, renderObservation)),
  );
  const stateIsCurrent = state.store === store;
  const renderState = stateIsCurrent
    ? state
    : readObserveState(store, renderObservation);
  const result = initialState
    ? initialState.result
    : stateIsCurrent
      ? store.readResultFromSnapshot(
          renderObservation,
          state.snapshot,
        )
      : renderState.result;

  useLayoutEffect(() => {
    observation.INTERNAL_read = read;
    bumpObservationVersion(observation);
    const removeFallbackTracker = manager !== defaultStoreManager
      ? undefined
      : manager.addFallbackTracker((managerStates) => {
          setState((previous) => ({ ...previous, managerStates }));
        });
    manager.addStore(store.concurrentStore as never);
    const mountSnapshot = store.getSnapshot();
    const committedSnapshot = store.getCommittedSnapshot();
    const mountResult = store.readResultFromSnapshot(observation, mountSnapshot);
    const committedResult = store.readResultFromSnapshot(
      observation,
      committedSnapshot,
    );

    if (INTERNAL_didResultChange(result, committedResult)) {
      setState({
        store,
        snapshot: committedSnapshot,
        phase: "sync",
        sequence: renderState.sequence,
        result: committedResult,
      });
    }

    if (INTERNAL_didResultChange(mountResult, committedResult)) {
      startTransition(() => {
        setState({
          store,
          snapshot: mountSnapshot,
          phase: "transition",
          sequence: renderState.sequence,
          result: mountResult,
        });
      });
    }

    const subscription = INTERNAL_subscribeStore(
      store,
      observation,
      (event) => {
        setState((previous) =>
          previous.store === store && previous.sequence > event.sequence
            ? previous
            : {
                store,
                snapshot: event.snapshot,
                phase: event.phase,
                sequence: event.sequence,
                result: event.result,
                managerStates: previous.managerStates,
              },
        );
      },
    );
    cell.subscription = subscription;

    return () => {
      if (cell.subscription === subscription) {
        cell.subscription = null;
      }
      subscription.unsubscribe();
      removeFallbackTracker?.();
      manager.removeStore(store.concurrentStore as never);
      manager.sweep();
    };
    // This effect intentionally uses the render result captured at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, observation, store]);

  useInsertionEffect(() => {
    const subscription = cell.subscription;
    if (!subscription || state.store !== store) {
      return;
    }
    observation.INTERNAL_read = read;
    bumpObservationVersion(observation);
    subscription.refreshFromRender(
      renderState.snapshot,
      renderState.phase,
    );
  });

  useLayoutEffect(() => {
    if (renderState.managerStates) {
      manager.commitAllStates(renderState.managerStates);
    }
  }, [manager, renderState.managerStates]);

  return result;
}

function unwrapSignalResult<Value>(result: SignalResult<Value>): Awaited<Value> {
  if (result.type === "error") {
    throw result.error;
  }
  const value = result.value;
  if (typeof (value as PromiseLike<unknown>)?.then === "function") {
    return usePromise(value as PromiseLike<Awaited<Value>>);
  }
  return value as Awaited<Value>;
}

export function useObserve<Value>(
  read: () => Value,
  options?: Options,
): Awaited<Value> {
  return unwrapSignalResult(useObservationResult(read, options));
}
