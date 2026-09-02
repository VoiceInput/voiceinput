import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = [
  "provider",
  "core",
  "react",
  "openai",
  "elevenlabs",
  "deepgram",
];
const require = createRequire(import.meta.url);

for (const name of packages) {
  const distribution = join(root, "packages", name, "dist");
  await import(pathToFileURL(join(distribution, "index.js")).href);
  require(join(distribution, "index.cjs"));

  if (["openai", "elevenlabs", "deepgram"].includes(name)) {
    await import(pathToFileURL(join(distribution, "server.js")).href);
    require(join(distribution, "server.cjs"));
  }
}

console.log(
  `Node ${process.version}: ESM and CommonJS package entries loaded.`,
);
