import {
  VoiceInputError,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";

export const ELEVENLABS_DEFAULT_MODEL = "scribe_v2_realtime";
export const ELEVENLABS_SAMPLE_RATE = 16_000;
const ELEVENLABS_DEFAULT_ENDPOINTING_MS = 650;

export interface ElevenLabsRealtimeSettings {
  readonly vadThreshold?: number;
  readonly minSpeechDurationMs?: number;
  readonly minSilenceDurationMs?: number;
  readonly noVerbatim?: boolean;
  readonly filterBackgroundAudio?: boolean;
}

export interface ElevenLabsSessionConfiguration {
  readonly model: string;
  readonly language?: string;
  readonly vocabulary?: readonly string[];
  readonly endpointing?: false | { readonly silenceMs: number };
  readonly vadThreshold?: number;
  readonly minSpeechDurationMs?: number;
  readonly minSilenceDurationMs?: number;
  readonly noVerbatim?: boolean;
  readonly filterBackgroundAudio?: boolean;
}

export function validateElevenLabsConfiguration(
  value: VoiceTranscriptionOptions &
    ElevenLabsRealtimeSettings & { readonly model: string },
): ElevenLabsSessionConfiguration {
  const model = nonEmptyString(value.model, "model");
  const language = normalizeLanguage(value.language);
  const vocabulary = validateVocabulary(value.vocabulary);
  const endpointing = validateEndpointing(
    value.endpointing === undefined
      ? { silenceMs: ELEVENLABS_DEFAULT_ENDPOINTING_MS }
      : value.endpointing,
  );
  const vadThreshold = optionalNumber(
    value.vadThreshold,
    "vadThreshold",
    0.1,
    0.9,
  );
  const minSpeechDurationMs = optionalInteger(
    value.minSpeechDurationMs,
    "minSpeechDurationMs",
    50,
    2_000,
  );
  const minSilenceDurationMs = optionalInteger(
    value.minSilenceDurationMs,
    "minSilenceDurationMs",
    50,
    2_000,
  );
  const noVerbatim = optionalBoolean(value.noVerbatim, "noVerbatim");
  const filterBackgroundAudio = optionalBoolean(
    value.filterBackgroundAudio,
    "filterBackgroundAudio",
  );

  return Object.freeze({
    model,
    ...(language === undefined ? {} : { language }),
    ...(vocabulary === undefined ? {} : { vocabulary }),
    ...(endpointing === undefined ? {} : { endpointing }),
    ...(vadThreshold === undefined ? {} : { vadThreshold }),
    ...(minSpeechDurationMs === undefined ? {} : { minSpeechDurationMs }),
    ...(minSilenceDurationMs === undefined ? {} : { minSilenceDurationMs }),
    ...(noVerbatim === undefined ? {} : { noVerbatim }),
    ...(filterBackgroundAudio === undefined ? {} : { filterBackgroundAudio }),
  });
}

export function createElevenLabsRealtimeUrl(
  baseUrl: string,
  token: string,
  configuration: ElevenLabsSessionConfiguration,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("model_id", configuration.model);
  url.searchParams.set("token", token);
  url.searchParams.set("audio_format", "pcm_16000");
  const hasVadSettings =
    configuration.vadThreshold !== undefined ||
    configuration.minSpeechDurationMs !== undefined ||
    configuration.minSilenceDurationMs !== undefined;
  if (configuration.endpointing === false) {
    url.searchParams.set("commit_strategy", "manual");
  } else if (configuration.endpointing !== undefined || hasVadSettings) {
    url.searchParams.set("commit_strategy", "vad");
  }
  if (configuration.language !== undefined) {
    url.searchParams.set("language_code", configuration.language);
  }
  for (const term of configuration.vocabulary ?? []) {
    url.searchParams.append("keyterms", term);
  }
  if (
    configuration.endpointing !== undefined &&
    configuration.endpointing !== false
  ) {
    url.searchParams.set(
      "vad_silence_threshold_secs",
      String(configuration.endpointing.silenceMs / 1_000),
    );
  }
  setOptional(url, "vad_threshold", configuration.vadThreshold);
  setOptional(url, "min_speech_duration_ms", configuration.minSpeechDurationMs);
  setOptional(
    url,
    "min_silence_duration_ms",
    configuration.minSilenceDurationMs,
  );
  setOptional(url, "no_verbatim", configuration.noVerbatim);
  setOptional(
    url,
    "filter_background_audio",
    configuration.filterBackgroundAudio,
  );
  return url.href;
}

function normalizeLanguage(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError("language must be a valid BCP 47 language tag.");
  }
  let language: string;
  try {
    language = new Intl.Locale(value).language;
  } catch {
    throw new TypeError("language must be a valid BCP 47 language tag.");
  }
  if (!/^[a-z]{2,3}$/u.test(language)) {
    throw unsupportedFeature(
      "ElevenLabs requires an ISO 639-1 or ISO 639-3 language code.",
    );
  }
  return language;
}

function validateVocabulary(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError("vocabulary must be an array of strings.");
  }
  const vocabulary = value.map((term) => {
    if (typeof term !== "string" || term.length === 0) {
      throw new TypeError(
        "ElevenLabs vocabulary terms must be non-empty strings.",
      );
    }
    if (term !== term.trim() || /[\r\n]/u.test(term)) {
      throw new TypeError(
        "ElevenLabs vocabulary terms must be trimmed strings without line breaks.",
      );
    }
    return term;
  });
  if (vocabulary.length > 50) {
    throw unsupportedFeature(
      "ElevenLabs vocabulary supports at most 50 terms.",
    );
  }
  if (vocabulary.some((term) => term.length > 20)) {
    throw unsupportedFeature(
      "ElevenLabs vocabulary terms support at most 20 characters.",
    );
  }
  return Object.freeze(vocabulary);
}

function validateEndpointing(
  value: VoiceTranscriptionOptions["endpointing"],
): ElevenLabsSessionConfiguration["endpointing"] {
  if (value === undefined || value === false) {
    return value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).some((key) => key !== "silenceMs") ||
    !Number.isInteger(value.silenceMs) ||
    value.silenceMs <= 0
  ) {
    throw new TypeError(
      "ElevenLabs endpointing silenceMs must be a positive integer.",
    );
  }
  if (value.silenceMs < 300 || value.silenceMs > 3_000) {
    throw unsupportedFeature(
      "ElevenLabs endpointing supports silenceMs from 300 to 3000.",
    );
  }
  return Object.freeze({ silenceMs: value.silenceMs });
}

function nonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalNumber(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function optionalInteger(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const result = optionalNumber(value, name, minimum, maximum);
  if (result !== undefined && !Number.isInteger(result)) {
    throw new TypeError(`${name} must be an integer.`);
  }
  return result;
}

function optionalBoolean(
  value: boolean | undefined,
  name: string,
): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function setOptional(
  url: URL,
  key: string,
  value: boolean | number | undefined,
): void {
  if (value !== undefined) {
    url.searchParams.set(key, String(value));
  }
}

function unsupportedFeature(message: string): VoiceInputError {
  return new VoiceInputError({
    code: "unsupported-feature",
    message,
    provider: "elevenlabs",
  });
}
