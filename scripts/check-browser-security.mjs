import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { unzipSync } from "fflate";

const rootDirectory = new URL("../", import.meta.url);
const providerPackages = ["openai", "elevenlabs", "deepgram"];
const artifactRoots = [
  "apps/playground-next/.next/static",
  "apps/playground-vite/dist",
  "playwright-report",
  "test-results",
  "log",
];
const secretEnvironmentNames = [
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "DEEPGRAM_API_KEY",
  "BROWSERSTACK_ACCESS_KEY",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "VOICEINPUT_DEV_AUTH_SECRET",
];

for (const packageName of providerPackages) {
  const packageJson = JSON.parse(
    readFileSync(
      new URL(`../packages/${packageName}/package.json`, import.meta.url),
      "utf8",
    ),
  );
  if (packageJson.exports?.["./server"]?.browser !== null) {
    throw new Error(
      `@voiceinput/${packageName}/server must be blocked by the browser export condition.`,
    );
  }
}

const secrets = secretEnvironmentNames.flatMap((name) => {
  const secret = process.env[name];
  return typeof secret === "string" && secret.length >= 12
    ? [{ name, bytes: Buffer.from(secret) }]
    : [];
});

for (const artifactRoot of artifactRoots) {
  const absoluteRoot = new URL(artifactRoot, rootDirectory);
  if (!existsSync(absoluteRoot)) {
    continue;
  }
  for (const file of walk(absoluteRoot)) {
    const contents = readFileSync(file);
    scan(contents, relative(rootDirectory.pathname, file));
    if (extname(file) === ".zip") {
      for (const [entryName, entryContents] of Object.entries(
        unzipSync(contents),
      )) {
        scan(
          entryContents,
          `${relative(rootDirectory.pathname, file)}:${entryName}`,
        );
      }
    }
  }
}

console.log(
  `Browser entrypoints are isolated; scanned ${artifactRoots.length} artifact locations for ${secrets.length} available secrets.`,
);

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory.pathname ?? directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function scan(contents, location) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  for (const secret of secrets) {
    if (bytes.indexOf(secret.bytes) !== -1) {
      throw new Error(`${secret.name} leaked into ${location}.`);
    }
  }
}
