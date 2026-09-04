import { readdir, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve("dist");
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
const errors = [];
for (const page of pages) {
  const html = await readFile(page, "utf8");
  for (const match of html.matchAll(
    /(?:href|src)="(\/(?!\/)[^"#?]*)(?:[?#][^"]*)?"/g,
  )) {
    const path = decodeURIComponent(match[1]);
    const candidates = [
      join(root, path),
      join(root, path, "index.html"),
      join(root, `${path}.html`),
    ];
    const found = await Promise.all(
      candidates.map((candidate) =>
        access(candidate).then(
          () => true,
          () => false,
        ),
      ),
    );
    if (!found.some(Boolean)) errors.push(`${page}: ${path}`);
  }
}
if (errors.length)
  throw new Error(`Broken internal links:\n${[...new Set(errors)].join("\n")}`);
console.log(`Verified local links in ${pages.length} HTML pages.`);
