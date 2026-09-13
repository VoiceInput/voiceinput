import type { TestResult } from "@playwright/test/reporter";
import { describe, expect, it } from "vitest";

import { missingVoiceLiveCredentials } from "./voice-live-global-setup.js";
import {
  categorize,
  createVoiceLiveReport,
  VoiceLiveReporter,
} from "./voice-live-reporter.js";

describe("voice live support", () => {
  it("reports missing credential names without their values", () => {
    const missing = missingVoiceLiveCredentials({
      OPENAI_API_KEY: "secret-openai",
      DEEPGRAM_API_KEY: "",
    });
    expect(missing).toEqual(["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"]);
    expect(JSON.stringify(missing)).not.toContain("secret-openai");
  });

  it("uses explicit failure categories", () => {
    expect(resultCategory("[voice-live:provider] phrase mismatch")).toBe(
      "provider",
    );
    expect(resultCategory("ordinary UI assertion")).toBe("application");
  });

  it("discards raw errors and secrets on the reporter test path", () => {
    const reporter = new VoiceLiveReporter();
    reporter.onTestEnd(
      { title: "OpenAI live browser" } as never,
      {
        status: "failed",
        duration: 1234,
        errors: [
          {
            message:
              "[voice-live:provider] secret-provider-key upstream response body",
          },
        ],
      } as TestResult,
    );
    const providers = (
      reporter as unknown as { providers: Array<Record<string, unknown>> }
    ).providers;
    const report = createVoiceLiveReport({
      schemaVersion: 1,
      sha: "abc123",
      dirtyWorktree: true,
      startedAt: "2026-09-13T00:00:00.000Z",
      browserVersion: "Chromium 140.0.0.0",
      outcome: "failed",
      configurationFailures: 1,
      providerFailures: 0,
      applicationFailures: 0,
      providers: providers as never,
    });
    const serialized = JSON.stringify(report);
    expect(report).toMatchObject({
      outcome: "failed",
      failures: { configuration: 1, provider: 1, application: 0 },
      providers: [
        {
          provider: "openai",
          durationMs: 1234,
          errorCode: "provider-check-failed",
        },
      ],
    });
    expect(serialized).not.toContain("upstream response body");
    expect(serialized).not.toContain("secret-provider-key");
  });
});

function resultCategory(message: string) {
  return categorize({
    status: "failed",
    errors: [{ message }],
  } as TestResult);
}
