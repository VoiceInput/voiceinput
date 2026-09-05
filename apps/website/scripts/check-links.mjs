import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve("dist");
const origin = "https://voiceinput.dev";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(join(directory, entry.name))
          : [join(directory, entry.name)],
      ),
    )
  ).flat();
}

const pages = (await files(root)).filter((file) => file.endsWith(".html"));
const contents = new Map(
  await Promise.all(
    pages.map(async (file) => [file, await readFile(file, "utf8")]),
  ),
);
const cache = new Map();
const errors = [];

async function resolveTarget(path) {
  if (cache.has(path)) return cache.get(path);
  const candidates = [
    join(root, path),
    join(root, path, "index.html"),
    join(root, path.replace(/\/$/, "") + ".html"),
  ];
  for (const candidate of candidates) {
    if (
      await stat(candidate).then(
        (info) => info.isFile(),
        () => false,
      )
    ) {
      cache.set(path, candidate);
      return candidate;
    }
  }
  cache.set(path, undefined);
}

for (const [page, html] of contents) {
  const pathname = "/" + relative(root, page).replace(/index\.html$/, "");
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = match[1].replace(/&amp;/g, "&");
    const url = new URL(href, origin + pathname);
    if (url.origin !== origin) continue;
    const path = decodeURIComponent(url.pathname);
    const target = await resolveTarget(path);
    if (!target) {
      errors.push(relative(root, page) + ": missing " + path);
      continue;
    }
    if (url.hash && target.endsWith(".html")) {
      const id = decodeURIComponent(url.hash.slice(1));
      const destination = contents.get(target);
      if (!destination?.includes('id="' + id + '"')) {
        errors.push(
          relative(root, page) + ": missing anchor " + url.pathname + url.hash,
        );
      }
    }
  }
}
if (errors.length)
  throw new Error("Broken internal links:\n" + [...new Set(errors)].join("\n"));
console.log(
  "Verified local files and fragment links in " + pages.length + " HTML pages.",
);
