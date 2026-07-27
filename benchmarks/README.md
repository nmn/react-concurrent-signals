# Performance benchmarks

Run the Node-only benchmark suite with:

```sh
npm run bench
```

Set `BENCHMARK_OUTPUT` to save Vitest's JSON report:

```sh
BENCHMARK_OUTPUT=benchmark-results.json npm run bench
```

For base/candidate comparisons, run each revision in a separate worktree and
alternate invocations between them at least three times. Compare medians rather
than a single run; close results should be treated as noise. The important
scaling checks are:

- 10,000 stored values versus one stored value for changed and no-op writes.
- 10,000 unrelated subscriptions versus one unrelated subscription.
- Chain depth 1,000 versus depth 100.
- Large related fan-out and effects, where linear callback work is expected.

The suite imports source files intentionally so it measures the implementation
under development rather than an accidentally stale `dist` directory.
