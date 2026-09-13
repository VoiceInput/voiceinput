import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const required = ["OPENAI_API_KEY", "DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"];

export function initializeVoiceLiveReport({
  environment = process.env,
  outputPath = "voice-live-results/report.json",
  now = () => new Date(),
  sha = git(["rev-parse", "HEAD"]) || "unknown",
  dirtyWorktree = git(["status", "--porcelain"]).length > 0,
} = {}) {
  const missing = required.filter(
    (name) => (environment[name] ?? "").trim().length === 0,
  );
  const configurationFailed = missing.length > 0;
  const report = {
    schemaVersion: 1,
    sha,
    dirtyWorktree,
    startedAt: now().toISOString(),
    browserVersion: null,
    outcome: "failed",
    errorCode: configurationFailed
      ? "configuration-missing"
      : "build-or-startup-pending",
    failures: {
      configuration: configurationFailed ? 1 : 0,
      provider: 0,
      application: configurationFailed ? 0 : 1,
    },
    providers: [],
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  return { missing, report };
}

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { missing } = initializeVoiceLiveReport();
  if (missing.length > 0) {
    process.stderr.write(
      `Live voice configuration is incomplete. Missing: ${missing.join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}
