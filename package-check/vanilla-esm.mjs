import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createStore, signal } from "react-concurrent-signals/vanilla";

const value$ = signal(1);
assert.equal(createStore().get(value$), 1);

const require = createRequire(import.meta.url);
assert.equal(
  Object.keys(require.cache).some((file) =>
    /node_modules[/\\]react[/\\]/.test(file),
  ),
  false,
  "the ESM vanilla entry loaded React",
);
