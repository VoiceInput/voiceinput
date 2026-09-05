import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { repositoryDocs } from "./scripts/sync-docs.mjs";
import { docs, groups } from "./src/lib/docs.ts";
export default defineConfig({
  site: "https://voiceinput.dev",
  output: "static",
  devToolbar: { enabled: false },
  vite: {
    server: {
      proxy: { "/api/demo": { target: "http://127.0.0.1:4322", ws: true } },
    },
  },
  integrations: [
    {
      name: "separate-vite-caches",
      hooks: {
        "astro:config:setup": ({ command, updateConfig }) => {
          // Build/sync also prebundle React. Keep their production runtime
          // from replacing the development server's JSX runtime on disk.
          updateConfig({ vite: { cacheDir: `node_modules/.vite/${command}` } });
        },
      },
    },
    repositoryDocs(),
    react(),
    starlight({
      title: "VoiceInput",
      disable404Route: true,
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/VoiceInput/voiceinput",
        },
      ],
      customCss: ["./src/styles/docs.css"],
      components: { SiteTitle: "./src/components/DocsTitle.astro" },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: groups.map((group) => ({
        label: group,
        collapsed: group === "Advanced",
        items: docs
          .filter((doc) => doc.group === group)
          .map((doc) => ({ slug: `docs/${doc.slug}` })),
      })),
      expressiveCode: {
        themes: ["github-light-high-contrast", "github-dark-high-contrast"],
        styleOverrides: {
          codeFontFamily: "'IBM Plex Mono', monospace",
          codeFontSize: "0.8125rem",
          borderRadius: "0.5rem",
        },
      },
    }),
  ],
});
