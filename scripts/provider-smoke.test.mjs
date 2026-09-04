import { describe, expect, it } from "vitest";

import { readRunOptions, wordErrorRate } from "./provider-smoke-support.mjs";

describe("provider smoke support", () => {
  it("parses measurement controls and bounds allocations and timers", () => {
    expect(
      readRunOptions([
        "--provider=elevenlabs",
        "--language=auto",
        "--vocabulary=VoiceInput,Quilter",
        "--chunk-ms=100",
        "--internal-silence-ms=700",
        "--trailing-silence-ms=1000",
        "--endpointing=650",
        "--json",
      ]),
    ).toMatchObject({
      provider: "elevenlabs",
      language: undefined,
      vocabulary: ["VoiceInput", "Quilter"],
      chunkMs: 100,
      internalSilenceMs: 700,
      trailingSilenceMs: 1_000,
      endpointing: { silenceMs: 650 },
      json: true,
    });
    expect(readRunOptions(["--repeat=2"]).repeat).toBe(2);
    expect(() => readRunOptions(["--repeat=4"])).toThrow(/1 to 3/u);
    expect(() => readRunOptions(["--chunk-ms=1001"])).toThrow(/1 to 1000/u);
    expect(() =>
      readRunOptions(["--trailing-silence-ms=9007199254740992"]),
    ).toThrow(/safe integer/u);
  });

  it("computes punctuation-insensitive word edit distance", () => {
    expect(
      wordErrorRate("BY HARRY QUILTER M A", "By Harry Quilter, M.A."),
    ).toBe(0);
    expect(wordErrorRate("BY HARRY QUILTER M A", "By Harry Quilter, MA.")).toBe(
      0.4,
    );
  });
});
