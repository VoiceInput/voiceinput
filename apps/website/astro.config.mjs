import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { repositoryDocs } from "./scripts/sync-docs.mjs";
import { demoProxy } from "./scripts/demo-proxy.mjs";
import { docs, groups } from "./src/lib/docs.ts";
export default defineConfig({
  site: "https://voiceinput.dev",
  output: "static",
  devToolbar: { enabled: false },
  vite: {
    server: {
      strictPort: true,
      proxy: { "/api/demo": demoProxy },
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
      favicon: "/favicon.png",
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://voiceinput.dev/social.png",
          },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:type", content: "image/png" },
        },
        { tag: "meta", attrs: { property: "og:image:width", content: "2172" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "724" } },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: "VoiceInput logo" },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://voiceinput.dev/social.png",
          },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:image:alt", content: "VoiceInput logo" },
        },
      ],
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
        collapsed: false,
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
