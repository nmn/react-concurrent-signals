import { expect, it } from "vitest";
import { PersistentValues } from "../src/persistent-values";

it("distinguishes missing IDs from explicit undefined values", () => {
  const key = {};
  const empty = PersistentValues.empty<object, undefined>();
  const values = empty.set(7, key, undefined);

  expect(empty.getEntry(7)).toBeUndefined();
  expect(values.getEntry(7)).toBeDefined();
  expect(values.getEntry(7)).toMatchObject({ id: 7, key, value: undefined });
});

it("shares unchanged entries without mutating earlier roots", () => {
  const firstKey = {};
  const secondKey = {};
  const first = PersistentValues.empty<object, number>().set(
    1,
    firstKey,
    10,
  );
  const firstEntry = first.getEntry(1);
  const second = first.set(65, secondKey, 20);

  expect(first.getEntry(65)).toBeUndefined();
  expect(second.getEntry(1)).toBe(firstEntry);
  expect(second.getEntry(65)?.value).toBe(20);

  const replaced = second.set(1, firstKey, 10);
  expect(replaced.getEntry(1)).not.toBe(firstEntry);
  expect(second.getEntry(1)).toBe(firstEntry);
});

it("applies several draft updates without changing the base table", () => {
  const keys = Array.from({ length: 80 }, () => ({}));
  const base = PersistentValues.empty<object, number>()
    .set(1, keys[1], 1)
    .set(1_025, keys[2], 2);
  const preservedEntry = base.getEntry(1_025);
  const draft = base.draft();

  draft.setEntry({ id: 1, key: keys[1], value: 11 });
  for (let id = 2; id < 80; ++id) {
    draft.setEntry({ id, key: keys[id], value: id });
  }

  expect(base.getEntry(1)?.value).toBe(1);
  expect(base.getEntry(79)).toBeUndefined();
  expect(draft.getEntry(1)?.value).toBe(11);
  expect(draft.getEntry(79)?.value).toBe(79);

  const next = draft.finish();
  expect(next.getEntry(1)?.value).toBe(11);
  expect(next.getEntry(79)?.value).toBe(79);
  expect(next.size).toBe(80);
  expect(next.getEntry(1_025)).toBe(preservedEntry);
  expect(base.getEntry(1_025)).toBe(preservedEntry);
  expect(() =>
    draft.setEntry({ id: 80, key: {}, value: 80 }),
  ).toThrow(/already finished/);
  expect(() => draft.finish()).toThrow(/already finished/);
});

it("returns the base identity when an unused draft is finished", () => {
  const base = PersistentValues.empty<object, number>().set(0, {}, 0);

  expect(base.draft().finish()).toBe(base);
});

it("supports the full non-negative safe integer ID range", () => {
  const ids = [
    0,
    31,
    32,
    1_023,
    1_024,
    1_048_576,
    Number.MAX_SAFE_INTEGER,
  ];
  const keys = ids.map(() => ({}));
  let values = PersistentValues.empty<object, number>();

  ids.forEach((id, index) => {
    values = values.set(id, keys[index], index);
  });

  ids.forEach((id, index) => {
    expect(values.getEntry(id)?.value).toBe(index);
  });
  expect(values.size).toBe(ids.length);
  expect(values.toMap()).toEqual(
    new Map(keys.map((key, index) => [key, index])),
  );
});

it("does not apply Object.is or initial-value canonicalization", () => {
  const key = {};
  const initial = PersistentValues.empty<object, number>().set(
    4,
    key,
    Number.NaN,
  );
  const initialEntry = initial.getEntry(4);
  const sameValue = initial.set(4, key, Number.NaN);
  const signedZero = sameValue.set(4, key, -0);

  expect(sameValue.getEntry(4)).not.toBe(initialEntry);
  expect(sameValue.size).toBe(1);
  expect(Object.is(signedZero.getEntry(4)?.value, -0)).toBe(true);
});
