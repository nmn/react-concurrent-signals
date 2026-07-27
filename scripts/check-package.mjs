import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const bundleSizeBaseline = JSON.parse(
  readFileSync(
    new URL("../package-check/bundle-size-baseline.json", import.meta.url),
    "utf8",
  ),
);

const collectExportTargets = (value, targets = []) => {
  if (typeof value === "string") {
    targets.push(value);
    return targets;
  }
  for (const nested of Object.values(value)) {
    collectExportTargets(nested, targets);
  }
  return targets;
};

for (const target of collectExportTargets(packageJson.exports)) {
  assert(
    existsSync(new URL(`..${target.slice(1)}`, import.meta.url)),
    `Missing package export target: ${target}`,
  );
}

for (const [subpath, conditions] of Object.entries(packageJson.exports)) {
  assert.match(
    conditions.require.types,
    /\.d\.cts$/,
    `CommonJS types for ${subpath} must resolve to .d.cts`,
  );
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
};

run(process.execPath, ["package-check/vanilla-esm.mjs"]);
run(process.execPath, ["package-check/vanilla-cjs.cjs"]);
run(process.execPath, ["package-check/runtime-esm.mjs"]);
run(process.execPath, ["package-check/runtime-cjs.cjs"]);
run(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "-p",
  "package-check/tsconfig.json",
]);

const gzipSizeForExtension = (extension) =>
  readdirSync(new URL("../dist", import.meta.url))
    .filter((file) => file.endsWith(extension))
    .reduce(
      (total, file) =>
        total +
        gzipSync(readFileSync(new URL(`../dist/${file}`, import.meta.url)))
          .byteLength,
      0,
    );

const esmGzipBytes = gzipSizeForExtension(".js");
const cjsGzipBytes = gzipSizeForExtension(".cjs");
const growthMultiplier = 1 + bundleSizeBaseline.maxGrowthPercent / 100;
const esmGzipLimit = Math.ceil(
  bundleSizeBaseline.esmGzipBytes * growthMultiplier,
);
const cjsGzipLimit = Math.ceil(
  bundleSizeBaseline.cjsGzipBytes * growthMultiplier,
);

// These format-wide budgets include shared chunks and all three public entries.
// The checked-in numbers describe the pre-optimization build. A 35% ceiling
// leaves room for the new data structures while catching dependency bundling or
// an unexpectedly large runtime regression.
assert(
  esmGzipBytes <= esmGzipLimit,
  `ESM runtime is ${esmGzipBytes} gzip bytes (limit: ${esmGzipLimit})`,
);
assert(
  cjsGzipBytes <= cjsGzipLimit,
  `CommonJS runtime is ${cjsGzipBytes} gzip bytes (limit: ${cjsGzipLimit})`,
);

console.log(
  `Package checks passed (ESM: ${esmGzipBytes} gzip bytes, CJS: ${cjsGzipBytes} gzip bytes).`,
);
