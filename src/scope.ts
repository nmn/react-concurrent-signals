import type {
  AnyWritableSignal,
  Signal,
  WritableSignal,
} from "./signal";

export type SignalStoreLike = {
  get<Value>(signal: Signal<Value>): Value;
  set<Value, Args extends unknown[], Result>(
    signal: WritableSignal<Value, Args, Result>,
    ...args: Args
  ): Result;
  run<Result>(fn: () => Result): Result;
};

export type ReadContext = {
  get<Value>(signal: Signal<Value>): Value;
};

export type WriteContext = {
  get<Value>(signal: Signal<Value>): Value;
  set(signal: AnyWritableSignal, args: readonly unknown[]): unknown;
};

let getDefaultStore: (() => SignalStoreLike) | undefined;
const storeStack: SignalStoreLike[] = [];
const readStack: ReadContext[] = [];
const writeStack: WriteContext[] = [];

export function setDefaultStoreGetter(getter: () => SignalStoreLike) {
  getDefaultStore = getter;
}

export function getActiveStore(): SignalStoreLike {
  const activeStore = storeStack.at(-1);
  if (activeStore) {
    return activeStore;
  }
  if (!getDefaultStore) {
    throw new Error("default signal store is not initialized");
  }
  return getDefaultStore();
}

export function getReadContext(): ReadContext | undefined {
  return readStack.at(-1);
}

export function getWriteContext(): WriteContext | undefined {
  return writeStack.at(-1);
}

export function withStoreScope<Result>(
  store: SignalStoreLike,
  fn: () => Result,
): Result {
  storeStack.push(store);
  try {
    return fn();
  } finally {
    storeStack.pop();
  }
}

export function withReadContext<Result>(
  context: ReadContext,
  fn: () => Result,
): Result {
  readStack.push(context);
  try {
    return fn();
  } finally {
    readStack.pop();
  }
}

export function withWriteContext<Result>(
  context: WriteContext,
  fn: () => Result,
): Result {
  writeStack.push(context);
  try {
    return fn();
  } finally {
    writeStack.pop();
  }
}
