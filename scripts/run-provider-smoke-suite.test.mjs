import { describe, expect, test } from "vitest";

import {
  providers,
  runProviderProcess,
  runProviderSmokeSuite,
} from "./run-provider-smoke-suite.mjs";

describe("provider smoke suite reporting", () => {
  test("attempts every provider and preserves separate outcomes", () => {
    const attempted = [];
    const report = runProviderSmokeSuite({
      sha: "candidate-sha",
      dirtyWorktree: false,
      now: () => new Date("2026-09-13T12:00:00.000Z"),
      runProvider(provider) {
        attempted.push(provider);
        return provider === "elevenlabs"
          ? {
              provider,
              durationMs: 12,
              outcome: "failed",
              errorCode: "provider-smoke-exit-1",
            }
          : { provider, durationMs: 10, outcome: "passed", details: {} };
      },
    });

    expect(attempted).toEqual(providers);
    expect(report.sha).toBe("candidate-sha");
    expect(report.dirtyWorktree).toBe(false);
    expect(report.outcome).toBe("failed");
    expect(report.providers.map(({ outcome }) => outcome)).toEqual([
      "passed",
      "failed",
      "passed",
    ]);
  });

  test("discards raw subprocess errors and success fields", () => {
    const secret = "sk-sensitive-value";
    const environment = { OPENAI_API_KEY: "configured" };
    const failure = runProviderProcess("openai", {
      environment,
      spawn: () => ({
        status: 1,
        stdout: "",
        stderr: `upstream returned ${secret}`,
      }),
    });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure).toMatchObject({
      provider: "openai",
      outcome: "failed",
      errorCode: "provider-smoke-exit-1",
    });

    const success = runProviderProcess("openai", {
      environment,
      spawn: () => ({
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          model: "model",
          repeat: 2,
          wordErrorRate: 0,
          credential: secret,
          transcript: secret,
        }),
      }),
    });
    expect(success.outcome).toBe("passed");
    expect(JSON.stringify(success)).not.toContain(secret);
    expect(success.details).not.toHaveProperty("credential");
    expect(success.details).not.toHaveProperty("transcript");
  });
});
