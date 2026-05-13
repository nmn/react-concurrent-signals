import { expect, it } from "vitest";
import { createStore, effect, getDefaultStore, signal, when } from "../src/vanilla";

it("supports primitive signals and store-scoped get/set", () => {
  const count$ = signal(0);
  const store = createStore();

  expect(store.run(() => count$())).toBe(0);
  store.run(() => count$.set(1));
  expect(store.run(() => count$())).toBe(1);
  store.run(() => count$.set((count) => count + 1));
  expect(store.run(() => count$())).toBe(2);
});

it("supports computed and writable derived signals", () => {
  const count$ = signal(1);
  const doubled$ = signal(() => count$() * 2);
  const add$ = signal(
    () => count$(),
    (amount: number) => count$.set(count$() + amount),
  );
  const increment$ = signal(
    () => null,
    () => count$.set(count$() + 1),
  );
  const store = createStore();

  expect(store.run(() => doubled$())).toBe(2);
  store.run(() => add$.set(4));
  expect(store.run(() => count$())).toBe(5);
  expect(store.run(() => doubled$())).toBe(10);
  store.run(() => increment$.set());
  expect(store.run(() => count$())).toBe(6);
});

it("notifies subscribers only when the observed result changes", () => {
  const count$ = signal(0);
  const other$ = signal("a");
  const doubled$ = signal(() => count$() * 2);
  const store = createStore();
  let calls = 0;

  const unsubscribe = store.sub(doubled$, () => {
    ++calls;
  });

  store.run(() => other$.set("b"));
  expect(calls).toBe(0);
  store.run(() => count$.set(1));
  expect(calls).toBe(1);
  store.run(() => count$.set(1));
  expect(calls).toBe(1);
  unsubscribe();
  store.run(() => count$.set(2));
  expect(calls).toBe(1);
});

it("keeps explicit stores isolated from the default store", () => {
  const count$ = signal(0);
  const store = createStore();
  const defaultStore = getDefaultStore();

  store.run(() => count$.set(10));
  defaultStore.run(() => count$.set(20));

  expect(store.run(() => count$())).toBe(10);
  expect(defaultStore.run(() => count$())).toBe(20);
});

it("runs effects in the active store scope", () => {
  const count$ = signal(0);
  const doubled$ = signal(0);
  const store = createStore();

  const unsubscribe = store.run(() =>
    effect(
      () => count$(),
      () => doubled$.set(count$() * 2),
    ),
  );

  expect(store.run(() => doubled$())).toBe(0);
  store.run(() => count$.set(2));
  expect(store.run(() => doubled$())).toBe(4);
  unsubscribe();
  store.run(() => count$.set(3));
  expect(store.run(() => doubled$())).toBe(4);
});

it("runs when callbacks when the predicate is true", () => {
  const count$ = signal(0);
  const hits$ = signal(0);
  const store = createStore();

  const unsubscribe = store.run(() =>
    when(
      () => count$() > 1,
      () => hits$.set((hits) => hits + 1),
    ),
  );

  expect(store.run(() => hits$())).toBe(0);
  store.run(() => count$.set(1));
  expect(store.run(() => hits$())).toBe(0);
  store.run(() => count$.set(2));
  expect(store.run(() => hits$())).toBe(1);
  store.run(() => count$.set(3));
  expect(store.run(() => hits$())).toBe(2);
  unsubscribe();
  store.run(() => count$.set(4));
  expect(store.run(() => hits$())).toBe(2);
});
