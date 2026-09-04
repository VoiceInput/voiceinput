import { defineConfig } from "astro/config";
import react from "@astrojs/react";
export default defineConfig({
  site: "https://voiceinput.dev",
  output: "static",
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: { build: { chunkSizeWarningLimit: 650 } },
});
