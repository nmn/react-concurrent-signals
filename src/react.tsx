import * as React from "react";
import {
  createContext,
  createElement,
  memo,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { StoreManager } from "./concurrent";
import { createObservation } from "./signal";
import {
  createStore,
  getDefaultStore,
  type SignalResult,
  type Store,
} from "./store";

type Options = {
  store?: Store;
};

const StoreContext = createContext<Store | undefined>(undefined);
const defaultStoreManager = new StoreManager();
const StoreManagerContext = createContext(defaultStoreManager);
const HasProviderCommitTrackerContext = createContext(false);

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown>)?.then === "function";

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

type PromiseWithStatus<T> = PromiseLike<T> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

function attachPromiseStatus<T>(promise: PromiseWithStatus<T>) {
  if (promise.status) {
    return;
  }
  promise.status = "pending";
  promise.then(
    (value) => {
      promise.status = "fulfilled";
      promise.value = value;
    },
    (reason) => {
      promise.status = "rejected";
      promise.reason = reason;
    },
  );
}

function usePromiseFallback<T>(promise: PromiseWithStatus<T>): T {
  attachPromiseStatus(promise);
  if (promise.status === "fulfilled") {
    return promise.value as T;
  }
  if (promise.status === "rejected") {
    throw promise.reason;
  }
  throw promise;
}

const useReactPromise = React.use as
  | (<T>(usable: PromiseLike<T>) => T)
  | undefined;
const usePromise = useReactPromise || usePromiseFallback;

const CommitTracker = memo(({ manager }: { manager: StoreManager }) => {
  const [allStates, setAllStates] = useState(() =>
    manager.getAllCommittedStates(),
  );

  useEffect(() => {
    const unsubscribe = manager.subscribe(() => {
      setAllStates(manager.getAllStates());
    });
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

function useCommitTracker(manager: StoreManager, enabled: boolean) {
  const [allStates, setAllStates] = useState(() =>
    manager.getAllCommittedStates(),
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const unsubscribe = manager.subscribe(() => {
      setAllStates(manager.getAllStates());
    });
    return () => {
      unsubscribe();
      manager.sweep();
    };
  }, [enabled, manager]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    manager.commitAllStates(allStates);
  }, [enabled, manager, allStates]);
}

export function useStore(options?: Options): Store {
  const store = useContext(StoreContext);
  return options?.store || store || getDefaultStore();
}

export function Provider({
  children,
  store,
}: {
  children?: ReactNode;
  store?: Store;
}): ReactElement {
  const storeRef = useRef<Store | null>(null);
  const managerRef = useRef<StoreManager | null>(null);
  if (!storeRef.current) {
    storeRef.current = store || createStore();
  }
  if (!managerRef.current) {
    managerRef.current = new StoreManager();
  }

  const scopedStore = store || storeRef.current;
  return createElement(
    StoreContext.Provider,
    { value: scopedStore },
    createElement(
      StoreManagerContext.Provider,
      { value: managerRef.current },
      createElement(
        HasProviderCommitTrackerContext.Provider,
        { value: true },
        createElement(CommitTracker, { manager: managerRef.current }),
        children,
      ),
    ),
  );
}

type ObserveState<Value> = {
  observation: ReturnType<typeof createObservation<Value>>;
  store: Store;
  result: SignalResult<Value>;
};

function useObservationResult<Value>(read: () => Value, options?: Options) {
  const store = useStore(options);
  const manager = useContext(StoreManagerContext);
  const hasProviderCommitTracker = useContext(HasProviderCommitTrackerContext);
  useCommitTracker(manager, !hasProviderCommitTracker);

  const readRef = useRef(read);
  readRef.current = read;
  const observationRef = useRef<ReturnType<typeof createObservation<Value>> | null>(
    null,
  );
  if (!observationRef.current) {
    observationRef.current = createObservation(() => readRef.current());
  }
  const observation = observationRef.current;
  const readCurrent = () =>
    store.readResultFromSnapshot(observation, store.getSnapshot());

  const [state, setState] = useState<ObserveState<Value>>(() => ({
    observation,
    store,
    result: readCurrent(),
  }));

  const result =
    state.store === store && state.observation === observation
      ? state.result
      : readCurrent();

  useLayoutEffect(() => {
    manager.addStore(store.concurrentStore as never);
    const mountResult = store.readResultFromSnapshot(
      observation,
      store.getSnapshot(),
    );
    const committedResult = store.readResultFromSnapshot(
      observation,
      store.getCommittedSnapshot(),
    );

    if (didResultChange(result, committedResult)) {
      setState({ observation, store, result: committedResult });
    }

    if (didResultChange(mountResult, committedResult)) {
      startTransition(() => {
        setState({ observation, store, result: mountResult });
      });
    }

    const unsubscribe = store.sub(observation, () => {
      setState({
        observation,
        store,
        result: store.readResultFromSnapshot(observation, store.getSnapshot()),
      });
    });

    return () => {
      unsubscribe();
      manager.removeStore(store.concurrentStore as never);
    };
    // This effect intentionally uses the render result captured at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, observation, store]);

  return result;
}

function unwrapSignalResult<Value>(result: SignalResult<Value>): Awaited<Value> {
  if (result.type === "error") {
    throw result.error;
  }
  const value = result.value;
  if (isPromiseLike(value)) {
    return usePromise(value as PromiseWithStatus<Awaited<Value>>);
  }
  return value as Awaited<Value>;
}

export function useObserve<Value>(
  read: () => Value,
  options?: Options,
): Awaited<Value> {
  return unwrapSignalResult(useObservationResult(read, options));
}
