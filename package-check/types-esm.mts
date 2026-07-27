import {
  createStore,
  signal,
  type Signal,
} from "react-concurrent-signals/vanilla";
import {
  Provider,
  useObserve,
  useStore,
} from "react-concurrent-signals/react";
import * as root from "react-concurrent-signals";

const count$ = signal(0);
const doubled$: Signal<number> = signal(() => count$() * 2);
const store = createStore();
const value: number = store.get(doubled$);

void Provider;
void useObserve;
void useStore;
void root.signal;
void value;
