import type { bench } from "vitest";

/**
 * Keep local runs short enough for iteration while requiring enough samples for
 * Vitest's benchmark reporter to expose noisy cases.
 */
export const benchmarkOptions = {
  iterations: 20,
  time: 250,
  warmupIterations: 5,
  warmupTime: 100,
} satisfies NonNullable<Parameters<typeof bench>[2]>;
