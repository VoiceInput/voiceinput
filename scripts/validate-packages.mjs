import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = [
  "provider",
  "core",
  "react",
  "openai",
  "elevenlabs",
  "deepgram",
];
const providerPackages = ["openai", "elevenlabs", "deepgram"];
const reactVersions = [
  { runtime: "18.3.1", types: "18.3.31" },
  { runtime: "19.2.8", types: "19.2.18" },
];

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
import { VoiceInputError } from "@voiceinput/provider";
import {
  createFakeVoiceInputProvider,
  createVoiceInputProviderV1ConformanceCases,
} from "@voiceinput/provider/test";
import { createVoiceInputSession } from "@voiceinput/core";
import { VoiceInputProvider, useVoiceInput } from "@voiceinput/react";
import "@voiceinput/openai";
import "@voiceinput/openai/server";
import "@voiceinput/elevenlabs";
import "@voiceinput/elevenlabs/server";
import "@voiceinput/deepgram";
import "@voiceinput/deepgram/server";

const fake = createFakeVoiceInputProvider({ sampleRate: 24_000 });
const cases = createVoiceInputProviderV1ConformanceCases({
  createHarness: () => createFakeVoiceInputProvider({ autoOpen: false }),
});

if (
  fake.provider.sampleRate !== 24_000 ||
  cases.length === 0 ||
  typeof createVoiceInputSession !== "function" ||
  typeof VoiceInputProvider !== "function" ||
  typeof useVoiceInput !== "function" ||
  !VoiceInputError.isInstance(
    new VoiceInputError({ code: "provider-error", message: "test" }),
  )
) {
  throw new Error("The provider or core runtime exports are invalid");
}

const stylesheet = import.meta.resolve("@voiceinput/react/styles.css");

if (!stylesheet.endsWith("/styles.css")) {
  throw new Error("The React stylesheet export did not resolve correctly");
}
`;

const cjsConsumer = `
const { VoiceInputError } = require("@voiceinput/provider");
const {
  createFakeVoiceInputProvider,
  createVoiceInputProviderV1ConformanceCases,
} = require("@voiceinput/provider/test");
const { createVoiceInputSession } = require("@voiceinput/core");
const { VoiceInputProvider, useVoiceInput } = require("@voiceinput/react");
require("@voiceinput/openai");
require("@voiceinput/openai/server");
require("@voiceinput/elevenlabs");
require("@voiceinput/elevenlabs/server");
require("@voiceinput/deepgram");
require("@voiceinput/deepgram/server");

const fake = createFakeVoiceInputProvider({ sampleRate: 24_000 });
const cases = createVoiceInputProviderV1ConformanceCases({
  createHarness: () => createFakeVoiceInputProvider({ autoOpen: false }),
});

if (
  fake.provider.sampleRate !== 24_000 ||
  cases.length === 0 ||
  typeof createVoiceInputSession !== "function" ||
  typeof VoiceInputProvider !== "function" ||
  typeof useVoiceInput !== "function" ||
  !VoiceInputError.isInstance(
    new VoiceInputError({ code: "provider-error", message: "test" }),
  )
) {
  throw new Error("The provider or core runtime exports are invalid");
}

const stylesheet = require.resolve("@voiceinput/react/styles.css");

if (!stylesheet.endsWith("/styles.css")) {
  throw new Error("The React stylesheet export did not resolve correctly");
}
`;

const typeConsumer = `
import type {
  VoiceInputProviderV1,
  VoiceInputProviderV1Session,
} from "@voiceinput/provider";
import {
  createFakeVoiceInputProvider,
  createVoiceInputProviderV1ConformanceCases,
} from "@voiceinput/provider/test";
import {
  createVoiceInputSession,
  type VoiceAudioSource,
} from "@voiceinput/core";
import type {
  UseVoiceInputOptions,
  UseVoiceInputResult,
} from "@voiceinput/react";
import "@voiceinput/openai";
import "@voiceinput/openai/server";
import "@voiceinput/elevenlabs";
import "@voiceinput/elevenlabs/server";
import "@voiceinput/deepgram";
import "@voiceinput/deepgram/server";

declare const provider: VoiceInputProviderV1;
declare const providerSession: VoiceInputProviderV1Session;
declare const audioSource: VoiceAudioSource;
declare const hookOptions: UseVoiceInputOptions;
declare const hookResult: UseVoiceInputResult;

provider.validateOptions({ language: "en-CA" });
providerSession.sendAudio(new Int16Array([1, 2]));
createVoiceInputSession({ provider, audioSource });
hookOptions.provider?.validateOptions({});
hookResult.stop("user");
createFakeVoiceInputProvider({ sampleRate: 16_000 });
createVoiceInputProviderV1ConformanceCases({
  createHarness: () => createFakeVoiceInputProvider({ autoOpen: false }),
});
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

const ssrConsumer = `
import React, { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import { VoiceInputProvider, useVoiceInput } from "@voiceinput/react";

const fake = createFakeVoiceInputProvider();
const audioSource = { prepare() { throw new Error("SSR must not prepare audio"); } };

function App() {
  const voice = useVoiceInput();
  return React.createElement("span", null, voice.status);
}

const warnings = [];
const originalConsoleError = console.error;
console.error = (...arguments_) => warnings.push(arguments_.join(" "));

try {
  const html = renderToString(
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        VoiceInputProvider,
        { provider: fake.provider, audioSource },
        React.createElement(App),
      ),
    ),
  );
  if (!html.includes("idle")) {
    throw new Error("The React SSR consumer did not render hook state");
  }
} finally {
  console.error = originalConsoleError;
}

if (warnings.some((warning) => warning.includes("useLayoutEffect"))) {
  throw new Error(
    "The React SSR consumer emitted a useLayoutEffect warning:\\n" +
      warnings.join("\\n"),
  );
}
`;

const reactBrowserConsumer = `
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import { VoiceInputProvider, useVoiceInput } from "@voiceinput/react";

const fake = createFakeVoiceInputProvider();
const audioSource = {
  async prepare() {
    let controller;
    const stream = new ReadableStream({
      start(streamController) {
        controller = streamController;
      },
    });
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        controller.close();
      }
    };
    return { stream, start() {}, stop: close, abort: close };
  },
};

function App() {
  const [value, setValue] = useState("");
  const voice = useVoiceInput({ value, onValueChange: setValue });
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("textarea", {
      "aria-label": "transcript",
      ref: voice.targetRef,
      value,
      onChange: (event) => setValue(event.currentTarget.value),
    }),
    React.createElement(
      "button",
      { "aria-label": "trigger", ...voice.triggerProps },
      "Speak",
    ),
  );
}

const root = createRoot(document.querySelector("#root"));
root.render(
  React.createElement(
    StrictMode,
    null,
    React.createElement(
      VoiceInputProvider,
      { provider: fake.provider, audioSource },
      React.createElement(App),
    ),
  ),
);

const waitFor = async (condition, message) => {
  const deadline = performance.now() + 5_000;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

try {
  await waitFor(
    () => document.querySelector('[aria-label="trigger"]')?.disabled === false,
    "The trigger never became enabled",
  );
  const textarea = document.querySelector('[aria-label="transcript"]');
  const trigger = document.querySelector('[aria-label="trigger"]');
  textarea.focus();
  textarea.setSelectionRange(0, 0);
  trigger.click();
  await fake.controller.waitForSession();
  fake.controller.emit({ type: "interim", text: "compat" });
  fake.controller.emit({ type: "final", text: "compatibility" });
  await waitFor(
    () => textarea.value === "compatibility",
    "The controlled target did not receive the transcript",
  );
  trigger.click();
  await waitFor(
    () => fake.controller.sessions[0]?.finishCallCount === 1,
    "The session did not finish",
  );
  root.unmount();
  document.documentElement.dataset.result = "passed";
} catch (error) {
  document.documentElement.dataset.error =
    error instanceof Error ? error.stack ?? error.message : String(error);
}
`;

const reactBrowserHtml = `<!doctype html>
<html><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;

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
    join(tmpdir(), `voiceinput-react-${reactVersion.runtime}-`),
  );

  try {
    console.log(`\nTesting clean consumers with React ${reactVersion.runtime}`);
    writeFileSync(
      join(consumerDirectory, "package.json"),
      `${JSON.stringify({ name: "voiceinput-consumer", private: true })}\n`,
    );
    writeFileSync(join(consumerDirectory, "consumer.mjs"), esmConsumer);
    writeFileSync(join(consumerDirectory, "consumer.cjs"), cjsConsumer);
    writeFileSync(join(consumerDirectory, "consumer.mts"), typeConsumer);
    writeFileSync(join(consumerDirectory, "consumer.cts"), typeConsumer);
    writeFileSync(join(consumerDirectory, "browser.mjs"), browserConsumer);
    writeFileSync(join(consumerDirectory, "ssr.mjs"), ssrConsumer);
    writeFileSync(
      join(consumerDirectory, "react-browser.mjs"),
      reactBrowserConsumer,
    );
    writeFileSync(join(consumerDirectory, "index.html"), reactBrowserHtml);
    writeFileSync(join(consumerDirectory, "tsconfig.json"), `${tsconfig}\n`);

    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        `react@${reactVersion.runtime}`,
        `react-dom@${reactVersion.runtime}`,
        `@types/react@${reactVersion.types}`,
        ...tarballs.values(),
      ],
      { cwd: consumerDirectory },
    );
    run("npm", ["ls", "react"], { cwd: consumerDirectory });
    run("node", ["consumer.mjs"], { cwd: consumerDirectory });
    run("node", ["consumer.cjs"], { cwd: consumerDirectory });
    run("node", ["ssr.mjs"], { cwd: consumerDirectory });
    run("node", ["--conditions=browser", "browser.mjs"], {
      cwd: consumerDirectory,
    });
    run(
      "pnpm",
      ["exec", "tsc", "--project", join(consumerDirectory, "tsconfig.json")],
      { cwd: rootDirectory },
    );
    run(
      "pnpm",
      [
        "exec",
        "rolldown",
        join(consumerDirectory, "react-browser.mjs"),
        "--file",
        join(consumerDirectory, "bundle.js"),
        "--format",
        "esm",
        "--platform",
        "browser",
      ],
      { cwd: rootDirectory },
    );
    await validateReactBrowserConsumer(consumerDirectory);
  } finally {
    rmSync(consumerDirectory, { force: true, recursive: true });
  }
}

console.log("\nAll packed-package checks passed.");

async function validateReactBrowserConsumer(directory) {
  const server = createServer((request, response) => {
    const fileName = request.url === "/bundle.js" ? "bundle.js" : "index.html";
    response.setHeader(
      "Content-Type",
      fileName.endsWith(".js") ? "text/javascript" : "text/html",
    );
    response.end(readFileSync(join(directory, fileName)));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not bind the React compatibility test server");
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.result === "passed" ||
        document.documentElement.dataset.error !== undefined,
    );
    const consumerError = await page.evaluate(
      () => document.documentElement.dataset.error,
    );
    if (consumerError !== undefined || pageErrors.length > 0) {
      throw new Error(
        consumerError ?? pageErrors.map((error) => error.stack).join("\n"),
      );
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
