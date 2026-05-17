import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    outDir: "dist",
    clean: true,
    external: ["next", "react"],
  },
  {
    entry: { fetch: "src/fetch.ts" },
    format: ["cjs", "esm"],
    dts: true,
    outDir: "dist",
    clean: false,
    external: [],
  },
  {
    entry: { "client/index": "src/client/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    outDir: "dist",
    clean: false,
    external: ["next", "react"],
    banner: { js: '"use client";' },
  },
]);
