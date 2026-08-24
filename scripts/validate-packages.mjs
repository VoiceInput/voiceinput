import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = ["core", "react", "openai", "elevenlabs", "deepgram"];
const providerPackages = ["openai", "elevenlabs", "deepgram"];
const reactVersions = ["18.3.1", "19.2.8"];

function run(command, arguments_, options = {}) {
  execFileSync(command, arguments_, {
    cwd: rootDirectory,
    stdio: "inherit",
    ...options,
  });
}

function findTarball(packageName) {
  const packageDirectory = join(rootDirectory, "packages", packageName);
  const tarball = readdirSync(packageDirectory)
    .filter((fileName) => fileName.endsWith(".tgz"))
    .sort()
    .at(-1);

  if (tarball === undefined) {
    throw new Error(`No packed tarball found for @voiceinput/${packageName}`);
  }

  return join(packageDirectory, tarball);
}

const tarballs = new Map(
  packages.map((packageName) => [packageName, findTarball(packageName)]),
);

for (const [packageName, tarball] of tarballs) {
  console.log(`\nValidating @voiceinput/${packageName}`);
  run("pnpm", ["exec", "publint", tarball, "--strict"]);

  const attwArguments = [
    "exec",
    "attw",
    tarball,
    "--profile",
    "node16",
    "--no-summary",
  ];

  if (packageName === "react") {
    attwArguments.push("--exclude-entrypoints", "styles.css");
  }

  run("pnpm", attwArguments);
}

const esmConsumer = `
import "@voiceinput/core";
import "@voiceinput/core/testing";
import "@voiceinput/react";
import "@voiceinput/openai";
import "@voiceinput/openai/server";
import "@voiceinput/elevenlabs";
import "@voiceinput/elevenlabs/server";
import "@voiceinput/deepgram";
import "@voiceinput/deepgram/server";

const stylesheet = import.meta.resolve("@voiceinput/react/styles.css");

if (!stylesheet.endsWith("/styles.css")) {
  throw new Error("The React stylesheet export did not resolve correctly");
}
`;

const cjsConsumer = `
require("@voiceinput/core");
require("@voiceinput/core/testing");
require("@voiceinput/react");
require("@voiceinput/openai");
require("@voiceinput/openai/server");
require("@voiceinput/elevenlabs");
require("@voiceinput/elevenlabs/server");
require("@voiceinput/deepgram");
require("@voiceinput/deepgram/server");

const stylesheet = require.resolve("@voiceinput/react/styles.css");

if (!stylesheet.endsWith("/styles.css")) {
  throw new Error("The React stylesheet export did not resolve correctly");
}
`;

const typeConsumer = `
import "@voiceinput/core";
import "@voiceinput/core/testing";
import "@voiceinput/react";
import "@voiceinput/openai";
import "@voiceinput/openai/server";
import "@voiceinput/elevenlabs";
import "@voiceinput/elevenlabs/server";
import "@voiceinput/deepgram";
import "@voiceinput/deepgram/server";
`;

const browserConsumer = `
await import("@voiceinput/openai");
await import("@voiceinput/elevenlabs");
await import("@voiceinput/deepgram");

const serverEntrypoints = ${JSON.stringify(
  providerPackages.map((packageName) => `@voiceinput/${packageName}/server`),
)};

for (const entrypoint of serverEntrypoints) {
  let blocked = false;

  try {
    await import(entrypoint);
  } catch (error) {
    blocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
  }

  if (!blocked) {
    throw new Error(\`Browser conditions did not block \${entrypoint}\`);
  }
}
`;

const tsconfig = JSON.stringify(
  {
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: "ES2022",
    },
    files: ["consumer.mts", "consumer.cts"],
  },
  undefined,
  2,
);

for (const reactVersion of reactVersions) {
  const consumerDirectory = mkdtempSync(
    join(tmpdir(), `voiceinput-react-${reactVersion}-`),
  );

  try {
    console.log(`\nTesting clean consumers with React ${reactVersion}`);
    writeFileSync(
      join(consumerDirectory, "package.json"),
      `${JSON.stringify({ name: "voiceinput-consumer", private: true })}\n`,
    );
    writeFileSync(join(consumerDirectory, "consumer.mjs"), esmConsumer);
    writeFileSync(join(consumerDirectory, "consumer.cjs"), cjsConsumer);
    writeFileSync(join(consumerDirectory, "consumer.mts"), typeConsumer);
    writeFileSync(join(consumerDirectory, "consumer.cts"), typeConsumer);
    writeFileSync(join(consumerDirectory, "browser.mjs"), browserConsumer);
    writeFileSync(join(consumerDirectory, "tsconfig.json"), `${tsconfig}\n`);

    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        `react@${reactVersion}`,
        ...tarballs.values(),
      ],
      { cwd: consumerDirectory },
    );
    run("npm", ["ls", "react"], { cwd: consumerDirectory });
    run("node", ["consumer.mjs"], { cwd: consumerDirectory });
    run("node", ["consumer.cjs"], { cwd: consumerDirectory });
    run("node", ["--conditions=browser", "browser.mjs"], {
      cwd: consumerDirectory,
    });
    run(
      "pnpm",
      ["exec", "tsc", "--project", join(consumerDirectory, "tsconfig.json")],
      { cwd: rootDirectory },
    );
  } finally {
    rmSync(consumerDirectory, { force: true, recursive: true });
  }
}

console.log("\nAll packed-package checks passed.");
