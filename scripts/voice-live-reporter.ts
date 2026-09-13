import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { chromium } from "playwright";

interface ProviderResult {
  provider: string;
  durationMs: number;
  outcome: TestResult["status"];
  category: "configuration" | "provider" | "application" | null;
  errorCode: string | null;
}

export class VoiceLiveReporter implements Reporter {
  private readonly providers: ProviderResult[] = [];
  private readonly startedAt = new Date().toISOString();
  private configurationFailures = 0;
  private providerFailures = 0;
  private applicationFailures = 0;

  onError(error: { message?: string }): void {
    const category = categorizeMessage(error.message ?? "");
    if (category === "configuration") this.configurationFailures += 1;
    else if (category === "provider") this.providerFailures += 1;
    else this.applicationFailures += 1;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const provider = test.title.match(/^(OpenAI|Deepgram|ElevenLabs)/u)?.[1];
    if (provider === undefined) return;
    const category = categorize(result);
    this.providers.push({
      provider: provider.toLowerCase(),
      durationMs: result.duration,
      outcome: result.status,
      category,
      errorCode: category === null ? null : `${category}-check-failed`,
    });
  }

  onEnd(result: FullResult): void {
    const report = createVoiceLiveReport({
      schemaVersion: 1,
      sha: readSha(),
      dirtyWorktree: hasDirtyWorktree(),
      startedAt: this.startedAt,
      browserVersion: readBrowserVersion(),
      outcome: result.status,
      configurationFailures: this.configurationFailures,
      providerFailures: this.providerFailures,
      applicationFailures: this.applicationFailures,
      providers: this.providers,
    });
    writeVoiceLiveReport(report);
  }
}

export function categorize(result: TestResult): ProviderResult["category"] {
  if (result.status === "passed" || result.status === "skipped") return null;
  const text = result.errors.map((error) => error.message ?? "").join(" ");
  return categorizeMessage(text);
}

function categorizeMessage(
  text: string,
): Exclude<ProviderResult["category"], null> {
  if (text.includes("[voice-live:configuration]")) return "configuration";
  if (text.includes("[voice-live:provider]")) return "provider";
  return "application";
}

export function createVoiceLiveReport(input: {
  schemaVersion: 1;
  sha: string;
  dirtyWorktree: boolean;
  startedAt: string;
  browserVersion: string | null;
  outcome: FullResult["status"];
  configurationFailures: number;
  providerFailures: number;
  applicationFailures: number;
  providers: ProviderResult[];
}): object {
  return {
    schemaVersion: input.schemaVersion,
    sha: input.sha,
    dirtyWorktree: input.dirtyWorktree,
    startedAt: input.startedAt,
    browserVersion: input.browserVersion,
    outcome: input.outcome,
    failures: {
      configuration:
        input.configurationFailures +
        input.providers.filter((entry) => entry.category === "configuration")
          .length,
      provider:
        input.providerFailures +
        input.providers.filter((entry) => entry.category === "provider").length,
      application:
        input.applicationFailures +
        input.providers.filter((entry) => entry.category === "application")
          .length,
    },
    providers: input.providers,
  };
}

export function writeConfigurationFailureReport(): void {
  writeVoiceLiveReport(
    createVoiceLiveReport({
      schemaVersion: 1,
      sha: readSha(),
      dirtyWorktree: hasDirtyWorktree(),
      startedAt: new Date().toISOString(),
      browserVersion: null,
      outcome: "failed",
      configurationFailures: 1,
      providerFailures: 0,
      applicationFailures: 0,
      providers: [],
    }),
  );
}

function readBrowserVersion(): string | null {
  try {
    return execFileSync(chromium.executablePath(), ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function writeVoiceLiveReport(report: object): void {
  const outputPath = resolve("voice-live-results/report.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}

function readSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function hasDirtyWorktree(): boolean {
  try {
    return (
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0
    );
  } catch {
    return true;
  }
}

export default VoiceLiveReporter;
