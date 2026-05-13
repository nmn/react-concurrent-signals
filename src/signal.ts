import type { Store } from "./store";
import { getActiveStore, getReadContext, getWriteContext } from "./scope";

export type SetStateAction<Value> = Value | ((prev: Value) => Value);

type Read<Value> = () => Value;
type Write<Args extends unknown[], Result> = (...args: Args) => Result;

type WithInitialValue<Value> = {
  init: Value;
};

type OnUnmount = () => void;
type OnMount<Args extends unknown[], Result> = (
  setSignal: (...args: Args) => Result,
) => OnUnmount | void;

const signalBrand = Symbol("react-concurrent-signals.signal");
const primitiveSignalBrand = Symbol("react-concurrent-signals.primitiveSignal");
const observationBrand = Symbol("react-concurrent-signals.observation");

export interface Signal<Value> {
  (): Value;
  toString: () => string;
  debugLabel?: string;
  debugPrivate?: boolean;
  INTERNAL_read?: Read<Value>;
  INTERNAL_onInit?: (store: Store) => void;
  readonly [signalBrand]: true;
}

export interface WritableSignal<
  Value,
  Args extends unknown[] = [SetStateAction<Value>],
  Result = void,
> extends Signal<Value> {
  set: (...args: Args) => Result;
  INTERNAL_write?: Write<Args, Result>;
  onMount?: OnMount<Args, Result>;
}

export interface Observation<Value> {
  toString: () => string;
  debugLabel?: string;
  debugPrivate?: boolean;
  INTERNAL_read: Read<Value>;
  readonly [observationBrand]: true;
}

export type AnySignal = Signal<unknown>;
export type AnyWritableSignal = WritableSignal<unknown, unknown[], unknown>;
export type AnyPrimitiveSignal = WritableSignal<unknown> &
  WithInitialValue<unknown> & {
    readonly [primitiveSignalBrand]: true;
  };
export type AnyObservation = Observation<unknown>;
export type AnyNode = AnySignal | AnyObservation;

let keyCount = 0;
let observationKeyCount = 0;

export function signal<Value, Args extends unknown[], Result>(
  read: Read<Value>,
  write: Write<Args, Result>,
): WritableSignal<Value, Args, Result>;

export function signal<Value>(read: Read<Value>): Signal<Value>;

export function signal<Value>(): WritableSignal<Value | undefined> &
  WithInitialValue<Value | undefined>;

export function signal<Value>(
  initialValue: Value,
): WritableSignal<Value> & WithInitialValue<Value>;

export function signal<Value, Args extends unknown[], Result>(
  readOrInitialValue?: Value | Read<Value>,
  write?: Write<Args, Result>,
) {
  const key = `signal${++keyCount}`;
  const config = function signalFunction() {
    return readSignal(config as AnySignal);
  } as WritableSignal<Value, Args, Result> & {
    init?: Value | undefined;
    [primitiveSignalBrand]?: true;
  };

  Object.defineProperties(config, {
    [signalBrand]: { value: true },
    toString: {
      value() {
        return this.debugLabel ? `${key}:${this.debugLabel}` : key;
      },
    },
  });

  if (typeof readOrInitialValue === "function") {
    config.INTERNAL_read = readOrInitialValue as Read<Value>;
  } else {
    config.init = readOrInitialValue;
    config.set = ((...args: unknown[]) =>
      writeSignal(config as AnyWritableSignal, args)) as never;
    Object.defineProperty(config, primitiveSignalBrand, {
      configurable: true,
      value: true,
    });
  }

  if (write) {
    config.INTERNAL_write = write;
    config.set = ((...args: unknown[]) =>
      writeSignal(config as AnyWritableSignal, args)) as never;
    delete config[primitiveSignalBrand];
  }

  return config;
}

export function createObservation<Value>(
  read: Read<Value>,
): Observation<Value> {
  const key = `observation${++observationKeyCount}`;
  return {
    [observationBrand]: true,
    INTERNAL_read: read,
    toString() {
      return this.debugLabel ? `${key}:${this.debugLabel}` : key;
    },
  };
}

export function isSignal(node: AnyNode): node is AnySignal {
  return (node as AnySignal)[signalBrand] === true;
}

export function isWritableSignal(
  signal: AnySignal,
): signal is AnyWritableSignal {
  return typeof (signal as AnyWritableSignal).set === "function";
}

export function isPrimitiveSignal(
  signal: AnySignal,
): signal is AnyPrimitiveSignal {
  return (signal as AnyPrimitiveSignal)[primitiveSignalBrand] === true;
}

export function readSignal<Value>(signal: Signal<Value>): Value {
  const readContext = getReadContext();
  if (readContext) {
    return readContext.get(signal);
  }
  const writeContext = getWriteContext();
  if (writeContext) {
    return writeContext.get(signal);
  }
  return getActiveStore().get(signal);
}

function writeSignal(signal: AnyWritableSignal, args: readonly unknown[]) {
  const writeContext = getWriteContext();
  if (writeContext) {
    return writeContext.set(signal, args);
  }
  return getActiveStore().set(signal, ...(args as unknown[]));
}
