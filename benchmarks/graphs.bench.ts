import { bench, describe } from "vitest";
import {
  createStore,
  signal,
  type Signal,
} from "../src/vanilla";
import { benchmarkOptions } from "./options";

type GraphFixture = {
  readAndInvalidate: () => number;
};

let graphResult = 0;

const createChain = (depth: number): GraphFixture => {
  const store = createStore();
  const source$ = signal(0);
  let tail$: Signal<number> = source$;

  for (let index = 0; index < depth; ++index) {
    const parent$ = tail$;
    tail$ = signal(() => parent$() + 1);
  }

  let next = 1;
  store.get(tail$);

  return {
    readAndInvalidate() {
      store.set(source$, next);
      next = next === 0 ? 1 : 0;
      return store.get(tail$);
    },
  };
};

const createDiamondChain = (depth: number): GraphFixture => {
  const store = createStore();
  const source$ = signal(0);
  let tail$: Signal<number> = source$;

  for (let index = 0; index < depth; ++index) {
    const parent$ = tail$;
    const left$ = signal(() => parent$() + 1);
    const right$ = signal(() => parent$() + 2);
    tail$ = signal(() => left$() + right$());
  }

  let next = 1;
  store.get(tail$);

  return {
    readAndInvalidate() {
      store.set(source$, next);
      next = next === 0 ? 1 : 0;
      return store.get(tail$);
    },
  };
};

const createWideDiamond = (width: number): GraphFixture => {
  const store = createStore();
  const source$ = signal(0);
  const branches: Signal<number>[] = [];

  for (let index = 0; index < width; ++index) {
    branches.push(signal(() => source$() + index));
  }

  const sum$ = signal(() => {
    let sum = 0;
    for (const branch$ of branches) {
      sum += branch$();
    }
    return sum;
  });

  let next = 1;
  store.get(sum$);

  return {
    readAndInvalidate() {
      store.set(source$, next);
      next = next === 0 ? 1 : 0;
      return store.get(sum$);
    },
  };
};

describe("graph invalidation and reads", () => {
  for (const depth of [1, 100, 1_000] as const) {
    const chain = createChain(depth);
    bench(
      `chain depth ${depth.toLocaleString("en-US")}`,
      () => {
        graphResult = chain.readAndInvalidate();
      },
      benchmarkOptions,
    );
  }

  for (const depth of [1, 25, 100] as const) {
    const diamond = createDiamondChain(depth);
    bench(
      `diamond chain depth ${depth.toLocaleString("en-US")}`,
      () => {
        graphResult = diamond.readAndInvalidate();
      },
      benchmarkOptions,
    );
  }

  for (const width of [10, 100, 1_000] as const) {
    const diamond = createWideDiamond(width);
    bench(
      `wide diamond with ${width.toLocaleString("en-US")} branches`,
      () => {
        graphResult = diamond.readAndInvalidate();
      },
      benchmarkOptions,
    );
  }
});

void graphResult;
