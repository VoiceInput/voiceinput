import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: true,
  },
  dts: {
    sourcemap: true,
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  sourcemap: true,
  target: "es2022",
});
