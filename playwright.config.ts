import { defineConfig } from "@playwright/test";

const developmentAuthSecret = "voiceinput-e2e-local-auth-secret";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "browserstack-safari.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  ...(process.env["CI"] ? { workers: 2 } : {}),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"]
    ? [["line"], ["html", { open: "never" }]]
    : "line",
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `VOICEINPUT_DEV_AUTH_SECRET=${developmentAuthSecret} pnpm --filter @voiceinput/playground-next dev`,
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
    {
      command: `VOICEINPUT_DEV_AUTH_SECRET=${developmentAuthSecret} pnpm --filter @voiceinput/playground-api dev:e2e`,
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @voiceinput/playground-vite dev --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
  ],
});
