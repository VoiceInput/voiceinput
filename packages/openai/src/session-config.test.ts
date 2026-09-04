import { describe, expect, it } from "vitest";

import {
  createOpenAITranscriptionSession,
  validateOpenAITokenRequest,
} from "./session-config.js";

describe("createOpenAITranscriptionSession", () => {
  it("selects server turn boundaries for the default model", () => {
    const session = createOpenAITranscriptionSession({
      model: "gpt-transcribe",
    });
    const input = getAudioInput(session);

    expect(input["turn_detection"]).toEqual({
      type: "server_vad",
      silence_duration_ms: 500,
    });
    expect(
      getAudioInput(
        createOpenAITranscriptionSession({ model: "gpt-live-transcribe" }),
      )["turn_detection"],
    ).toBeNull();
  });

  it("maps vocabulary to the mechanism supported by each model family", () => {
    const committedTurn = getTranscription(
      createOpenAITranscriptionSession({
        model: "gpt-transcribe",
        vocabulary: ["VoiceInput"],
      }),
    );
    const live = getTranscription(
      createOpenAITranscriptionSession({
        model: "gpt-live-transcribe",
        language: "en",
        vocabulary: ["VoiceInput"],
      }),
    );

    expect(committedTurn).toMatchObject({
      prompt: "Expected vocabulary: VoiceInput.",
    });
    expect(committedTurn).not.toHaveProperty("keywords");
    expect(live).toMatchObject({
      keywords: ["VoiceInput"],
      languages: ["en"],
    });
    expect(live).not.toHaveProperty("prompt");
  });

  it("maps BCP 47 tags to OpenAI language codes", () => {
    const transcription = getTranscription(
      createOpenAITranscriptionSession(
        validateOpenAITokenRequest({
          model: "gpt-transcribe",
          language: "en-CA",
        }),
      ),
    );

    expect(transcription["language"]).toBe("en");
  });
});

function getAudioInput(session: Record<string, unknown>) {
  return (session["audio"] as { input: Record<string, unknown> }).input;
}

function getTranscription(session: Record<string, unknown>) {
  return getAudioInput(session)["transcription"] as Record<string, unknown>;
}
