import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/**/*.browser.test.ts"],
    include: ["src/**/*.test.ts"],
  },
});
