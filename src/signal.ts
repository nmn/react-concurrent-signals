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

const signalBrand = Symbol();
const primitiveSignalBrand = Symbol();
const observationBrand = Symbol();
const observationId = Symbol();
const observationVersion = Symbol();

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

type SignalWithId = {
  readonly [signalBrand]: number;
};

type ObservationWithVersion = AnyObservation & {
  [observationVersion]: number;
};

type ObservationWithId = AnyObservation & {
  readonly [observationId]: number;
};

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
  const id = ++keyCount;
  const isDerived = typeof readOrInitialValue === "function";
  const config = function signalFunction() {
    return readSignal(config as AnySignal);
  } as WritableSignal<Value, Args, Result> & {
    init?: Value | undefined;
    [primitiveSignalBrand]?: true;
  };

  Object.defineProperties(config, {
    [signalBrand]: { value: id },
    toString: {
      value() {
        const key = `signal${id}`;
        return this.debugLabel ? `${key}:${this.debugLabel}` : key;
      },
    },
  });

  if (isDerived) {
    config.INTERNAL_read = readOrInitialValue as Read<Value>;
  } else {
    config.init = readOrInitialValue;
    config.set = ((value: unknown) =>
      writePrimitiveSignal(
        config as unknown as AnyPrimitiveSignal,
        value,
      )) as never;
    Object.defineProperty(config, primitiveSignalBrand, {
      configurable: true,
      writable: true,
    });
  }

  if (write) {
    config.INTERNAL_write = write;
    config.set = ((...args: unknown[]) =>
      writeSignal(config as AnyWritableSignal, args)) as never;
    if (!isDerived) {
      delete config[primitiveSignalBrand];
    }
  }

  return config;
}

export function createObservation<Value>(
  read: Read<Value>,
): Observation<Value> {
  const id = ++observationKeyCount;
  return {
    [observationBrand]: true,
    [observationId]: id,
    [observationVersion]: 0,
    INTERNAL_read: read,
    toString: observationToString,
  } as Observation<Value>;
}

function observationToString(this: ObservationWithId): string {
  const key = `observation${this[observationId]}`;
  return this.debugLabel ? `${key}:${this.debugLabel}` : key;
}

export function getSignalId(signal: AnySignal): number {
  return (signal as unknown as SignalWithId)[signalBrand];
}

export function getObservationVersion(observation: AnyObservation): number {
  return (observation as ObservationWithVersion)[observationVersion];
}

export function bumpObservationVersion(observation: AnyObservation): number {
  return ++(observation as ObservationWithVersion)[observationVersion];
}

export function isSignal(node: AnyNode): node is AnySignal {
  return (
    typeof (node as unknown as SignalWithId)[signalBrand] ===
    "number"
  );
}

export function isWritableSignal(
  signal: AnySignal,
): signal is AnyWritableSignal {
  return typeof (signal as AnyWritableSignal).set === "function";
}

export function isPrimitiveSignal(
  signal: AnySignal,
): signal is AnyPrimitiveSignal {
  return primitiveSignalBrand in signal;
}

export function getPrimitiveDependencySet(
  signal: AnyPrimitiveSignal,
): ReadonlySet<AnyPrimitiveSignal> {
  type PrimitiveWithDependencies = {
    [primitiveSignalBrand]?: ReadonlySet<AnyPrimitiveSignal>;
  };
  return (
    (signal as unknown as PrimitiveWithDependencies)[
      primitiveSignalBrand
    ] ||=
      new Set([signal])
  );
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

function writePrimitiveSignal(
  signal: AnyPrimitiveSignal,
  value: unknown,
): void {
  const writeContext = getWriteContext();
  if (writeContext) {
    writeContext.setPrimitive(signal, value);
    return;
  }
  (
    getActiveStore() as unknown as SignalStoreLikeWithPrimitiveWrite
  ).INTERNAL_setPrimitive(signal, value);
}

type SignalStoreLikeWithPrimitiveWrite = {
  INTERNAL_setPrimitive(
    signal: AnyPrimitiveSignal,
    value: unknown,
  ): void;
};
