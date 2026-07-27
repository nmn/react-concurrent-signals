import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    benchmark: {
      include: ["benchmarks/**/*.bench.ts"],
      outputJson: process.env.BENCHMARK_OUTPUT,
      reporters: "verbose",
    },
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
  },
});
