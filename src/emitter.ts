export type INTERNAL_EmitterOrdered = {
  readonly order: number;
};

type ListenerEntry<T extends unknown[]> = INTERNAL_EmitterOrdered & {
  readonly listener: (...args: T) => void;
};

type EmitterInternals<T extends unknown[]> = {
  listeners?: Map<(...args: T) => void, ListenerEntry<T>>;
  listenerSnapshot?: ListenerEntry<T>[];
  nextOrder?: number;
  virtualCount?: number;
};

const getInternals = <T extends unknown[]>(emitter: Emitter<T>) =>
  emitter as Emitter<T> & EmitterInternals<T>;

export const INTERNAL_hasEmitterListeners = <T extends unknown[]>(
  emitter: Emitter<T>,
): boolean => !!getInternals(emitter).listeners?.size;

const notifyMerged = <
  T extends unknown[],
  Selected extends INTERNAL_EmitterOrdered,
>(
  listeners: readonly ListenerEntry<T>[],
  selected: readonly Selected[],
  invokeSelected: (selected: Selected, ...args: T) => void,
  args: T,
) => {
  let listenerIndex = 0;
  let selectedIndex = 0;
  while (
    listenerIndex < listeners.length ||
    selectedIndex < selected.length
  ) {
    const listener = listeners[listenerIndex];
    const virtualListener = selected[selectedIndex];
    if (
      !virtualListener ||
      (listener && listener.order < virtualListener.order)
    ) {
      ++listenerIndex;
      listener.listener(...args);
    } else {
      ++selectedIndex;
      invokeSelected(virtualListener, ...args);
    }
  }
};

export function INTERNAL_registerEmitterVirtualListener<
  T extends unknown[],
>(
  emitter: Emitter<T>,
): number {
  const internals = getInternals(emitter);
  internals.virtualCount = (internals.virtualCount || 0) + 1;
  return (internals.nextOrder = (internals.nextOrder || 0) + 1);
}

export function INTERNAL_unregisterEmitterVirtualListener<
  T extends unknown[],
>(emitter: Emitter<T>): void {
  --(getInternals(emitter).virtualCount as number);
}

export function INTERNAL_notifyEmitterSelected<
  T extends unknown[],
  Selected extends INTERNAL_EmitterOrdered,
>(
  emitter: Emitter<T>,
  selected: readonly Selected[],
  invokeSelected: (selected: Selected, ...args: T) => void,
  ...args: T
): void {
  const internals = getInternals(emitter);
  const listeners =
    internals.listenerSnapshot ||
    (internals.listenerSnapshot = Array.from(
      (internals.listeners as Map<
        (...args: T) => void,
        ListenerEntry<T>
      >).values(),
    ));
  notifyMerged(listeners, selected, invokeSelected, args);
}

export class Emitter<T extends unknown[]> {
  subscribe(listener: (...args: T) => void): () => void {
    const internals = getInternals(this);
    const listeners = (internals.listeners ||= new Map());
    let entry = listeners.get(listener);
    if (!entry) {
      entry = {
        order: (internals.nextOrder = (internals.nextOrder || 0) + 1),
        listener,
      };
      listeners.set(listener, entry);
      internals.listenerSnapshot = undefined;
    }
    return () => {
      if (listeners.get(listener) === entry) {
        listeners.delete(listener);
        internals.listenerSnapshot = undefined;
      }
    };
  }

  notify(...args: T): void {
    const internals = getInternals(this);
    if (!internals.listeners?.size) {
      return;
    }
    const listeners =
      internals.listenerSnapshot ||
      (internals.listenerSnapshot = Array.from(
        internals.listeners.values(),
      ));
    for (const entry of listeners) {
      entry.listener(...args);
    }
  }

  listenerCount(): number {
    const internals = getInternals(this);
    return (
      (internals.listeners?.size || 0) +
      (internals.virtualCount || 0)
    );
  }
}
