import { getActiveStore } from "./scope";
import { createObservation, signal } from "./signal";
import type { SignalResult, Store } from "./store";

export { createStore, getDefaultStore } from "./store";
export type { SignalResult, Snapshot, Store } from "./store";
export { signal };
export type {
  Observation,
  SetStateAction,
  Signal,
  WritableSignal,
} from "./signal";

const unwrapResult = <Value>(result: SignalResult<Value>): Value => {
  if (result.type === "error") {
    throw result.error;
  }
  return result.value;
};

export function effect(read: () => unknown, write: () => void): () => void {
  const store = getActiveStore() as Store;
  const observation = createObservation(read);
  const runWrite = (result: SignalResult<unknown>) => {
    unwrapResult(result);
    store.run(write);
  };
  const unsubscribe = store.subEffect(observation, runWrite);
  runWrite(store.readResultFromSnapshot(observation, store.getSnapshot()));
  return unsubscribe;
}

export function when(read: () => boolean, write: () => void): () => void {
  const store = getActiveStore() as Store;
  const observation = createObservation(read);
  const runWriteWhenTrue = (result: SignalResult<boolean>) => {
    if (unwrapResult(result)) {
      store.run(write);
    }
  };
  const unsubscribe = store.subEffect(observation, runWriteWhenTrue);
  runWriteWhenTrue(store.readResultFromSnapshot(observation, store.getSnapshot()));
  return unsubscribe;
}
