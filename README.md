# react-concurrent-signals

Signal functions backed by the same concurrent-safe snapshot mechanics as
`react-concurrent-jotai`.

```tsx
import { signal, useObserve } from "react-concurrent-signals";

const count$ = signal(0);
const doubled$ = signal(() => count$() * 2);

function Counter() {
  const label = useObserve(() => `${count$()} / ${doubled$()}`);
  return (
    <button onClick={() => count$.set((count) => count + 1)}>
      {label}
    </button>
  );
}
```

Signals are store-scoped. Outside React, run signal reads and writes inside a
store:

```ts
import { createStore, effect, when } from "react-concurrent-signals";

const store = createStore();

store.run(() => {
  count$.set(1);
  console.log(count$());
});
```

Effects can derive writes from tracked reads:

```ts
store.run(() => {
  effect(() => count$(), () => doubled$.set(count$() * 2));
  when(() => count$() > 10, () => count$.set(10));
});
```

Scoped React providers also use stores. If a component is inside a custom
provider store, scope event-handler writes with `useStore().run(...)`.

## Examples

```sh
npm run dev:examples
```

The concurrent-safety example lives in `examples/concurrent-safety` and uses
StyleX for component styling.
