import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env["VOICEINPUT_WEBSITE_TEST_PORT"] ?? 14322);
if (!Number.isSafeInteger(testPort) || testPort < 1 || testPort > 65_535) {
  throw new TypeError("VOICEINPUT_WEBSITE_TEST_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  use: { baseURL },
  webServer: {
    command: "node scripts/serve-tests.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
