import { readFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

export const docs = [
  {
    slug: "quickstart",
    title: "Quickstart",
    group: "Get started",
    source: "README.md",
  },
  {
    slug: "golden-paths",
    title: "Example projects",
    group: "Get started",
    source: "docs/golden-paths.md",
  },
  {
    slug: "react",
    title: "React API",
    group: "Reference",
    source: "packages/react/README.md",
  },
  {
    slug: "core",
    title: "Core API",
    group: "Reference",
    source: "packages/core/README.md",
  },
  {
    slug: "provider",
    title: "Provider contract",
    group: "Reference",
    source: "packages/provider/README.md",
  },
  {
    slug: "providers/openai",
    title: "OpenAI",
    group: "Providers",
    source: "packages/openai/README.md",
  },
  {
    slug: "providers/elevenlabs",
    title: "ElevenLabs",
    group: "Providers",
    source: "packages/elevenlabs/README.md",
  },
  {
    slug: "providers/deepgram",
    title: "Deepgram",
    group: "Providers",
    source: "packages/deepgram/README.md",
  },
  {
    slug: "nextjs",
    title: "Next.js",
    group: "Integration",
    source: "docs/nextjs.md",
  },
  {
    slug: "vite-hono",
    title: "Vite + Hono",
    group: "Integration",
    source: "docs/vite-hono.md",
  },
  {
    slug: "express",
    title: "Express",
    group: "Integration",
    source: "docs/express.md",
  },
  {
    slug: "form-integration",
    title: "Composers and forms",
    group: "Integration",
    source: "docs/form-integration.md",
  },
  {
    slug: "authentication-recipes",
    title: "Authentication",
    group: "Integration",
    source: "docs/authentication-recipes.md",
  },
  {
    slug: "editing-contract",
    title: "Editing and undo",
    group: "Guides",
    source: "docs/editing-contract.md",
  },
  {
    slug: "custom-provider",
    title: "Custom providers",
    group: "Guides",
    source: "docs/custom-provider.md",
  },
  {
    slug: "content-security-policy",
    title: "Content security policy",
    group: "Guides",
    source: "docs/content-security-policy.md",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    group: "Guides",
    source: "docs/troubleshooting.md",
  },
  {
    slug: "support-policy",
    title: "Support policy",
    group: "Guides",
    source: "docs/support-policy.md",
  },
];
export const groups = [...new Set(docs.map((doc) => doc.group))];
const root = resolve(process.cwd(), "../..");
export async function renderDoc(doc: (typeof docs)[number]) {
  let markdown = await readFile(resolve(root, doc.source), "utf8");
  if (doc.slug === "quickstart") {
    const start = markdown.indexOf("## Quickstart");
    const end = markdown.indexOf("## Try it without credentials");
    markdown = markdown.slice(start, end).replace(/^## Quickstart\n/, "");
    markdown = markdown.replace(/^### /gm, "## ");
    markdown =
      "Add streaming speech to an existing React field. This desktop beta supports React 18 and 19.\n\n" +
      markdown;
  } else markdown = markdown.replace(/^# .+\n/, "");
  // Rewrite repository-relative links to public docs or the exact GitHub file.
  markdown = markdown.replace(/\]\(([^\s)]+)\)/g, (full, href: string) => {
    if (/^(https?:|mailto:|#)/.test(href)) return full;
    const [path, hash] = href.split("#");
    const file = relative(
      root,
      resolve(root, dirname(doc.source), path),
    ).replace(/\/$/, "");
    const linked = docs.find(
      (item) => item.source === file || item.source === `${file}/README.md`,
    );
    const target = linked
      ? `/docs/${linked.slug}`
      : `https://github.com/VoiceInput/voiceinput/${/\.[a-z]+$/i.test(file) ? "blob" : "tree"}/main/${file}`;
    return `](${target}${hash ? `#${hash}` : ""})`;
  });
  const processor = await createMarkdownProcessor({
    shikiConfig: { theme: "github-light-high-contrast" },
    gfm: true,
  });
  return processor.render(markdown);
}
