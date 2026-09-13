import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const providers = ["openai", "elevenlabs", "deepgram"];

export function createFailureResult(provider, durationMs, errorCode) {
  return { provider, durationMs, outcome: "failed", errorCode };
}

export function runProviderSmokeSuite({
  runProvider = runProviderProcess,
  now = () => new Date(),
  sha = readSha(),
  dirtyWorktree = hasDirtyWorktree(),
} = {}) {
  const startedAt = now().toISOString();
  const results = providers.map((provider) => runProvider(provider));
  return {
    schemaVersion: 1,
    sha,
    dirtyWorktree,
    startedAt,
    runtime: process.version,
    outcome: results.every((result) => result.outcome === "passed")
      ? "passed"
      : "failed",
    providers: results,
  };
}

export function runProviderProcess(
  provider,
  { spawn = spawnSync, environment = process.env } = {},
) {
  const environmentName = `${provider === "elevenlabs" ? "ELEVENLABS" : provider.toUpperCase()}_API_KEY`;
  if (!environment[environmentName]?.trim()) {
    return createFailureResult(
      provider,
      0,
      `missing-${environmentName.toLowerCase()}`,
    );
  }
  const startedAt = performance.now();
  const result = spawn(
    process.execPath,
    [
      "scripts/provider-smoke.mjs",
      `--provider=${provider}`,
      "--repeat=2",
      "--json",
    ],
    {
      encoding: "utf8",
      env: environment,
      timeout: 90_000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    },
  );
  const durationMs = Math.round(performance.now() - startedAt);
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout.trim());
      const details = {
        model: parsed.model,
        repeat: parsed.repeat,
        wordErrorRate: parsed.wordErrorRate,
        audioDurationMs: parsed.audioDurationMs,
        connectionMs: parsed.connectionMs,
        firstInterimMs: parsed.firstInterimMs,
        firstFinalMs: parsed.firstFinalMs,
        finalizationMs: parsed.finalizationMs,
        finalParts: parsed.finalParts,
        tokenExpiresIn: parsed.tokenExpiresIn,
      };
      return { provider, durationMs, outcome: "passed", details };
    } catch {
      return createFailureResult(provider, durationMs, "invalid-json-report");
    }
  }
  return createFailureResult(
    provider,
    durationMs,
    result.error?.code === "ETIMEDOUT"
      ? "process-timeout"
      : `provider-smoke-exit-${result.status ?? "unknown"}`,
  );
}

function readSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function hasDirtyWorktree() {
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

function writeReport(report) {
  const outputPath = resolve(
    process.env["PROVIDER_SMOKE_REPORT"] ??
      "provider-smoke-results/report.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = runProviderSmokeSuite();
  writeReport(report);
  process.exitCode = report.outcome === "passed" ? 0 : 1;
}
