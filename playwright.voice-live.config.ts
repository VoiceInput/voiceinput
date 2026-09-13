import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

process.env["PLAYWRIGHT_NO_COPY_PROMPT"] = "1";

const developmentAuthSecret = "voiceinput-live-local-auth-secret";
const microphoneFixture = resolve(
  "fixtures/audio/librispeech-1272-128104-0014.wav",
);

export default defineConfig({
  testDir: "./voice-live",
  testMatch: "*.voice-live.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: true,
  globalSetup: "./scripts/voice-live-global-setup.ts",
  reporter: [["./scripts/voice-live-reporter.ts"]],
  outputDir: "voice-live-results/artifacts",
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:5175",
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${microphoneFixture}%noloop`,
      ],
    },
  },
  projects: [{ name: "chromium-live", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: `VOICEINPUT_DEV_AUTH_SECRET=${developmentAuthSecret} VOICEINPUT_PLAYGROUND_API_PORT=8789 pnpm --filter @voiceinput/playground-api dev:e2e`,
      url: "http://127.0.0.1:8789/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "node scripts/start-voice-live-vite.mjs",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
