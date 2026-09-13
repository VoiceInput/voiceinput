import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { initializeVoiceLiveReport } from "./voice-live-preflight.mjs";

describe("voice live preflight report", () => {
  test("replaces stale pass evidence before build or startup", () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-live-preflight-"));
    const outputPath = join(directory, "report.json");
    try {
      writeFileSync(outputPath, '{"outcome":"passed"}\n');
      const { missing } = initializeVoiceLiveReport({
        environment: {
          OPENAI_API_KEY: "openai",
          DEEPGRAM_API_KEY: "deepgram",
          ELEVENLABS_API_KEY: "elevenlabs",
        },
        outputPath,
        now: () => new Date("2026-09-13T12:00:00.000Z"),
        sha: "candidate-sha",
        dirtyWorktree: false,
      });
      const report = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(missing).toEqual([]);
      expect(report).toMatchObject({
        sha: "candidate-sha",
        startedAt: "2026-09-13T12:00:00.000Z",
        outcome: "failed",
        errorCode: "build-or-startup-pending",
        failures: { configuration: 0, application: 1 },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("records only missing credential names", () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-live-preflight-"));
    const outputPath = join(directory, "report.json");
    try {
      const { missing, report } = initializeVoiceLiveReport({
        environment: { OPENAI_API_KEY: "secret-openai" },
        outputPath,
      });
      expect(missing).toEqual(["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"]);
      expect(report.errorCode).toBe("configuration-missing");
      expect(JSON.stringify(report)).not.toContain("secret-openai");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
