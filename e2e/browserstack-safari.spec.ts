import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import browserstack from "browserstack-local";

const userName = requiredEnvironmentVariable("BROWSERSTACK_USERNAME");
const accessKey = requiredEnvironmentVariable("BROWSERSTACK_ACCESS_KEY");
const localIdentifier = `voiceinput-desktop-${process.pid}-${Date.now()}`;
const authorization = `Basic ${Buffer.from(`${userName}:${accessKey}`).toString("base64")}`;
const webdriverEndpoint = "https://hub-cloud.browserstack.com/wd/hub";
const testResultsDirectory = fileURLToPath(
  new URL("../test-results/", import.meta.url),
);
mkdirSync(testResultsDirectory, { recursive: true });
const local = new browserstack.Local();

const playgrounds = [
  { name: "Next.js App Router", url: "http://127.0.0.1:3000" },
  { name: "Vite + Hono", url: "http://127.0.0.1:5173" },
] as const;
const desktopBrowsers = [
  {
    name: "Safari 26.4 / macOS Tahoe",
    browserName: "safari",
    browserVersion: "26.4",
    os: "OS X",
    osVersion: "Tahoe",
  },
  {
    name: "Safari 18.4 / macOS Sequoia",
    browserName: "safari",
    browserVersion: "18.4",
    os: "OS X",
    osVersion: "Sequoia",
  },
  {
    name: "Firefox 154 / Windows 11",
    browserName: "firefox",
    browserVersion: "154",
    os: "Windows",
    osVersion: "11",
  },
  {
    name: "Firefox 153 / Windows 11",
    browserName: "firefox",
    browserVersion: "153",
    os: "Windows",
    osVersion: "11",
  },
] as const;

test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    local.start(
      {
        key: accessKey,
        localIdentifier,
        onlyAutomate: true,
        logFile: join(testResultsDirectory, "browserstack-local.log"),
      },
      (error) => (error === undefined ? resolve() : reject(error)),
    );
  });
});

test.afterAll(async () => {
  if (!local.isRunning()) {
    return;
  }
  await new Promise<void>((resolve) => local.stop(resolve));
});

for (const desktopBrowser of desktopBrowsers) {
  for (const playground of playgrounds) {
    test(`${desktopBrowser.name} runs ${playground.name}`, async () => {
      const sessionName = `${desktopBrowser.name} / ${playground.name}`;
      let sessionId: string | undefined;
      try {
        sessionId = await createSession(desktopBrowser, sessionName);
        await webdriverRequest(`session/${sessionId}/url`, {
          method: "POST",
          body: { url: playground.url },
        });
        await waitFor(
          sessionId,
          `return document.querySelector("h1")?.textContent === "Voice Lab" &&
            document.body.innerText.includes(arguments[0]);`,
          [playground.name],
          "playground shell",
        );

        for (const label of ["Select phrase", "Start active"]) {
          await clickButton(sessionId, label);
        }
        await waitFor(
          sessionId,
          `const field = document.querySelector('textarea[aria-label="Controlled textarea"]');
           return field?.parentElement?.innerText.includes("listening") === true;`,
          [],
          "listening state",
        );

        await clickButton(sessionId, "Revise interim");
        await waitFor(
          sessionId,
          `return document.querySelector('textarea[aria-label="Controlled textarea"]')?.value.includes("hello") === true;`,
          [],
          "interim transcript",
        );

        await clickButton(sessionId, "Emit final");
        await waitFor(
          sessionId,
          `const field = document.querySelector('textarea[aria-label="Controlled textarea"]');
           const body = document.body.innerText;
           return field?.value.includes("hello from VoiceInput") === true &&
             body.includes("audio-received") && body.includes('{"chunks":1}') &&
             field.parentElement?.innerText.includes("idle") === true;`,
          [],
          "final transcript and PCM receipt",
        );

        await setSessionStatus(sessionId, "passed", "Voice flow completed.");
      } catch (error) {
        if (sessionId !== undefined) {
          await setSessionStatus(
            sessionId,
            "failed",
            safeErrorMessage(error),
          ).catch(() => {});
        }
        throw error;
      } finally {
        if (sessionId !== undefined) {
          await webdriverRequest(`session/${sessionId}`, {
            method: "DELETE",
          }).catch(() => {});
        }
      }
    });
  }
}

async function createSession(
  desktopBrowser: (typeof desktopBrowsers)[number],
  sessionName: string,
): Promise<string> {
  const value = await webdriverRequest("session", {
    method: "POST",
    body: {
      capabilities: {
        alwaysMatch: {
          browserName: desktopBrowser.browserName,
          browserVersion: desktopBrowser.browserVersion,
          "bstack:options": {
            os: desktopBrowser.os,
            osVersion: desktopBrowser.osVersion,
            projectName: "VoiceInput",
            buildName: "branded desktop playgrounds",
            buildIdentifier: process.env["BUILD_NUMBER"] ?? "local",
            sessionName,
            local: true,
            localIdentifier,
            debug: false,
            networkLogs: false,
            video: false,
          },
        },
      },
    },
  });
  const sessionId = readRecord(value)["sessionId"];
  if (typeof sessionId !== "string") {
    throw new Error("BrowserStack did not return a WebDriver session ID.");
  }
  return sessionId;
}

async function clickButton(sessionId: string, label: string): Promise<void> {
  const clicked = await executeScript(
    sessionId,
    `const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === arguments[0]);
     if (button === undefined) return false;
     button.click();
     return true;`,
    [label],
  );
  expect(clicked, `Expected the ${label} button to exist.`).toBe(true);
}

async function waitFor(
  sessionId: string,
  script: string,
  arguments_: readonly unknown[],
  description: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await executeScript(sessionId, script, arguments_)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function executeScript(
  sessionId: string,
  script: string,
  arguments_: readonly unknown[] = [],
): Promise<unknown> {
  return await webdriverRequest(`session/${sessionId}/execute/sync`, {
    method: "POST",
    body: { script, args: arguments_ },
  });
}

async function setSessionStatus(
  sessionId: string,
  status: "passed" | "failed",
  reason: string,
): Promise<void> {
  const command = JSON.stringify({
    action: "setSessionStatus",
    arguments: { status, reason: reason.slice(0, 240) },
  });
  await executeScript(sessionId, `browserstack_executor: ${command}`);
}

async function webdriverRequest(
  path: string,
  options: { method: "POST" | "DELETE"; body?: unknown },
): Promise<unknown> {
  const response = await fetch(`${webdriverEndpoint}/${path}`, {
    method: options.method,
    headers: {
      Authorization: authorization,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as unknown;
  const value = readRecord(payload)["value"];
  const error = readRecord(value)["error"];
  if (!response.ok || typeof error === "string") {
    const providerMessage = readRecord(value)["message"];
    throw new Error(
      typeof providerMessage === "string"
        ? `BrowserStack WebDriver error: ${providerMessage}`
        : `BrowserStack WebDriver request failed with ${response.status}.`,
    );
  }
  return value;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for branded desktop tests.`);
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown browser failure.";
}
