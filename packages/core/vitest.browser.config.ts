import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { AUDIO_WORKLET_SOURCE } from "./src/audio-worklet-source.js";

export default defineConfig({
  plugins: [
    {
      name: "voiceinput-worklet-fixture",
      configureServer(server) {
        server.middlewares.use(
          "/voiceinput-worklet.js",
          (_request, response) => {
            response.setHeader(
              "Content-Type",
              "text/javascript; charset=utf-8",
            );
            response.end(AUDIO_WORKLET_SOURCE);
          },
        );
      },
    },
  ],
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright({
        launchOptions: {
          args: [
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        contextOptions: { permissions: ["microphone"] },
      }),
    },
    include: ["src/**/*.browser.test.ts"],
  },
});
