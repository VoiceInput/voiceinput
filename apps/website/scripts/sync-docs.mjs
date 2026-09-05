import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docs } from "../src/lib/docs.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = fileURLToPath(
  new URL("../src/content/docs/docs/", import.meta.url),
);
const sources = new Set(docs.map((doc) => resolve(root, doc.source)));

function docLink(href, source) {
  if (/^(mailto:|#|\/)/.test(href)) return href;
  const github = "https://github.com/VoiceInput/voiceinput/";
  let file;
  let hash;
  if (
    href.startsWith(`${github}blob/main/`) ||
    href.startsWith(`${github}tree/main/`)
  ) {
    [file, hash] = href
      .replace(`${github}blob/main/`, "")
      .replace(`${github}tree/main/`, "")
      .split("#");
  } else {
    if (/^https?:/.test(href)) return href;
    const [path, fragment] = href.split("#");
    file = relative(root, resolve(root, dirname(source), path)).replace(
      /\/$/,
      "",
    );
    hash = fragment;
  }
  const linked = docs.find(
    (doc) => doc.source === file || doc.source === `${file}/README.md`,
  );
  const target = linked
    ? `/docs/${linked.slug}/`
    : `${github}${/\.[a-z]+$/i.test(file) ? "blob" : "tree"}/main/${file}`;
  return `${target}${hash ? `#${hash}` : ""}`;
}

export function prepareMarkdown(markdown, source) {
  // Rewrite prose links without touching paths inside copyable code examples.
  markdown = markdown
    .replace(/^# .+\n/, "")
    .split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/m)
    .map((part) =>
      part.startsWith("```")
        ? part
        : part.replace(
            /\]\(([^\s)]+)\)/g,
            (_, href) => `](${docLink(href, source)})`,
          ),
    )
    .join("");
  // Explicit pairs stay readable in GitHub. Starlight owns tab interactions.
  markdown = markdown.replace(
    /\*\*npm\*\*\n\n(```(?:bash|sh)\n[\s\S]*?\n```)\n\n\*\*pnpm\*\*\n\n(```(?:bash|sh)\n[\s\S]*?\n```)/g,
    (_, npm, pnpm) =>
      `<Tabs syncKey="package-manager">\n<TabItem label="npm">\n\n${npm}\n\n</TabItem>\n<TabItem label="pnpm">\n\n${pnpm}\n\n</TabItem>\n</Tabs>`,
  );
  return markdown;
}

async function syncDocs() {
  const expected = new Set();
  for (const doc of docs) {
    const target = resolve(output, `${doc.slug}.mdx`);
    expected.add(target);
    const body = prepareMarkdown(
      await readFile(resolve(root, doc.source), "utf8"),
      doc.source,
    );
    const metadata = {
      title: doc.title,
      description: doc.description,
      editUrl: `https://github.com/VoiceInput/voiceinput/edit/main/${doc.source}`,
    };
    const content = `---\n${JSON.stringify(metadata, null, 2)}\n---\n\nimport { Tabs, TabItem } from '@astrojs/starlight/components';\n${body}`;
    await mkdir(dirname(target), { recursive: true });
    const previous = await readFile(target, "utf8").catch(() => "");
    if (previous !== content) await writeFile(target, content);
  }
  for (const file of await readdir(output, { recursive: true })) {
    const target = resolve(output, file);
    if (file.endsWith(".mdx") && !expected.has(target)) await unlink(target);
  }
}

/** @returns {import('astro').AstroIntegration} */
export function repositoryDocs() {
  return {
    name: "voiceinput-repository-docs",
    hooks: {
      "astro:config:setup": async () => {
        await syncDocs();
      },
      "astro:server:setup": ({ server, logger }) => {
        server.watcher.add([...sources]);
        let pending = Promise.resolve();
        server.watcher.on("change", (file) => {
          if (!sources.has(resolve(file))) return;
          pending = pending
            .then(syncDocs)
            .catch((error) => logger.error(String(error)));
        });
      },
    },
  };
}
