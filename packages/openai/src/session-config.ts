import {
  VoiceInputError,
  type VoiceEndpointingOptions,
  type VoiceTranscriptionOptions,
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
  const turnDetection = createTurnDetection(options.endpointing, liveModel);

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
  if (
    model.startsWith("gpt-live-transcribe") &&
    endpointing !== undefined &&
    endpointing !== false
  ) {
    throw unsupportedFeature(
      "gpt-live-transcribe does not support server turn detection. Use endpointing: false for one manually committed segment, or choose gpt-transcribe for phrase boundaries.",
    );
  }

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
    throw unsupportedFeature(
      "OpenAI requires a language tag with an ISO 639-1 primary language subtag.",
    );
  }
  return primaryLanguage;
}

function createTurnDetection(
  endpointing: false | VoiceEndpointingOptions | undefined,
  liveModel: boolean,
): Record<string, unknown> | null {
  if (endpointing === false || liveModel) {
    return null;
  }
  return {
    type: "server_vad",
    silence_duration_ms: endpointing?.silenceMs ?? 500,
  };
}

function validateVocabulary(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError("vocabulary must be an array of strings.");
  }
  const vocabulary = value.map((term) => {
    if (
      typeof term !== "string" ||
      term.trim().length === 0 ||
      term !== term.trim() ||
      /[<>\r\n]/u.test(term)
    ) {
      throw new TypeError(
        "Vocabulary terms must be trimmed strings without angle brackets or line breaks.",
      );
    }
    return term;
  });
  if (vocabulary.length > 100) {
    throw unsupportedFeature("OpenAI vocabulary supports at most 100 terms.");
  }
  if (vocabulary.some((term) => term.length > 200)) {
    throw unsupportedFeature(
      "OpenAI vocabulary terms support at most 200 characters.",
    );
  }
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

function unsupportedFeature(message: string): VoiceInputError {
  return new VoiceInputError({
    code: "unsupported-feature",
    message,
    provider: "openai",
  });
}
