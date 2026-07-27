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
  setPrimitive(signal: AnyWritableSignal, value: unknown): void;
};

let getDefaultStore: (() => SignalStoreLike) | undefined;
let currentStore: SignalStoreLike | undefined;
let currentReadContext: ReadContext | undefined;
let currentWriteContext: WriteContext | undefined;

export function setDefaultStoreGetter(getter: () => SignalStoreLike) {
  getDefaultStore = getter;
}

export function getActiveStore(): SignalStoreLike {
  if (currentStore) {
    return currentStore;
  }
  if (!getDefaultStore) {
    throw Error();
  }
  return getDefaultStore();
}

export function getReadContext(): ReadContext | undefined {
  return currentReadContext;
}

export function getWriteContext(): WriteContext | undefined {
  return currentWriteContext;
}

export function withStoreScope<Result>(
  store: SignalStoreLike,
  fn: () => Result,
): Result {
  const previousStore = currentStore;
  currentStore = store;
  try {
    return fn();
  } finally {
    currentStore = previousStore;
  }
}

export function withReadContext<Result>(
  context: ReadContext,
  fn: () => Result,
): Result {
  const previousContext = currentReadContext;
  currentReadContext = context;
  try {
    return fn();
  } finally {
    currentReadContext = previousContext;
  }
}

export function withWriteContext<Result>(
  context: WriteContext,
  fn: () => Result,
): Result {
  const previousContext = currentWriteContext;
  currentWriteContext = context;
  try {
    return fn();
  } finally {
    currentWriteContext = previousContext;
  }
}
