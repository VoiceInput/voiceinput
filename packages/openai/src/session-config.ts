import type {
  VoiceEndpointingOptions,
  VoiceTranscriptionOptions,
} from "@voiceinput/provider";

export const OPENAI_DEFAULT_MODEL = "gpt-transcribe";
export const OPENAI_SAMPLE_RATE = 24_000;

export interface OpenAITokenRequest extends VoiceTranscriptionOptions {
  model: string;
}

export function createOpenAITranscriptionSession(
  options: OpenAITokenRequest,
): Record<string, unknown> {
  const vocabulary = options.vocabulary ?? [];
  const liveModel = options.model.startsWith("gpt-live-transcribe");
  const prompt =
    liveModel || vocabulary.length === 0
      ? undefined
      : `Expected vocabulary: ${vocabulary.join(", ")}.`;
  const turnDetection = createTurnDetection(options.endpointing);

  return {
    type: "transcription",
    audio: {
      input: {
        format: {
          type: "audio/pcm",
          rate: OPENAI_SAMPLE_RATE,
        },
        transcription: {
          model: options.model,
          ...(prompt === undefined ? {} : { prompt }),
          ...(liveModel && vocabulary.length > 0
            ? { keywords: vocabulary }
            : {}),
          ...(options.language === undefined
            ? {}
            : liveModel
              ? { languages: [options.language] }
              : { language: options.language }),
        },
        ...(turnDetection === undefined
          ? {}
          : { turn_detection: turnDetection }),
      },
    },
  };
}

export function validateOpenAITokenRequest(
  value: unknown,
  defaultModel = OPENAI_DEFAULT_MODEL,
): OpenAITokenRequest {
  if (!isRecord(value)) {
    throw new TypeError("The token request body must be a JSON object.");
  }

  const model = value["model"] ?? defaultModel;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new TypeError("model must be a non-empty string.");
  }

  const language = normalizeLanguage(value["language"]);
  if (
    language !== undefined &&
    (language.trim().length === 0 || language.length > 64)
  ) {
    throw new TypeError("language must be a non-empty string.");
  }

  const vocabulary = validateVocabulary(value["vocabulary"]);
  const endpointing = validateEndpointing(value["endpointing"]);

  return {
    model,
    ...(language === undefined ? {} : { language }),
    ...(vocabulary === undefined ? {} : { vocabulary }),
    ...(endpointing === undefined ? {} : { endpointing }),
  };
}

function normalizeLanguage(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError("language must be a valid BCP 47 language tag.");
  }
  let primaryLanguage: string;
  try {
    primaryLanguage = new Intl.Locale(value).language;
  } catch {
    throw new TypeError("language must be a valid BCP 47 language tag.");
  }
  if (!/^[a-z]{2}$/u.test(primaryLanguage)) {
    throw new TypeError(
      "OpenAI requires a language tag with an ISO 639-1 primary language subtag.",
    );
  }
  return primaryLanguage;
}

function createTurnDetection(
  endpointing: false | VoiceEndpointingOptions | undefined,
): Record<string, unknown> | null | undefined {
  if (endpointing === undefined) {
    return undefined;
  }
  if (endpointing === false) {
    return null;
  }
  return {
    type: "server_vad",
    silence_duration_ms: endpointing.silenceMs,
  };
}

function validateVocabulary(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("vocabulary must contain at most 100 strings.");
  }
  const vocabulary = value.map((term) => {
    if (
      typeof term !== "string" ||
      term.trim().length === 0 ||
      term !== term.trim() ||
      term.length > 200 ||
      /[<>\r\n]/u.test(term)
    ) {
      throw new TypeError(
        "Vocabulary terms must be trimmed strings without angle brackets or line breaks.",
      );
    }
    return term;
  });
  return Object.freeze(vocabulary);
}

function validateEndpointing(
  value: unknown,
): false | VoiceEndpointingOptions | undefined {
  if (value === undefined || value === false) {
    return value;
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "silenceMs") ||
    !Number.isInteger(value["silenceMs"]) ||
    (value["silenceMs"] as number) <= 0
  ) {
    throw new TypeError(
      "endpointing must be false or an object with a positive integer silenceMs.",
    );
  }
  return { silenceMs: value["silenceMs"] as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
