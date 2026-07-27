"use strict";

const assert = require("node:assert/strict");
const { createStore, signal } = require("react-concurrent-signals/vanilla");

const value$ = signal(1);
assert.equal(createStore().get(value$), 1);
assert.equal(
  Object.keys(require.cache).some((file) =>
    /node_modules[/\\]react[/\\]/.test(file),
  ),
  false,
  "the CommonJS vanilla entry loaded React",
);
