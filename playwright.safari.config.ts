import { defineConfig } from "@playwright/test";

import baseConfig from "./playwright.config.js";

export default defineConfig(baseConfig, {
  testIgnore: [],
  testMatch: "browserstack-safari.spec.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 120_000,
});
