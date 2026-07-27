import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "waku/config";

const packageEntry = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

const stylexPlugin = stylex.vite({
  debug: process.env.NODE_ENV === "development",
  enableDebugClassNames: false,
  enableDevClassNames: false,
  useCSSLayers: true,
  devMode: "css-only",
  devPersistToDisk: true,
  runtimeInjection: false,
});

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "react-concurrent-signals": packageEntry,
      },
    },
    plugins: [
      stylexPlugin,
      react(),
    ],
  },
});
