import {
  VoiceInputError,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";

export const DEEPGRAM_DEFAULT_MODEL = "nova-3";
export const DEEPGRAM_SAMPLE_RATE = 16_000;

const GENERAL_NOVA_ENGLISH_LANGUAGES = new Set([
  "en",
  "en-AU",
  "en-GB",
  "en-IN",
  "en-NZ",
  "en-US",
]);

export interface DeepgramRealtimeSettings {
  readonly smartFormat?: boolean;
  readonly punctuate?: boolean;
  readonly profanityFilter?: boolean;
  readonly numerals?: boolean;
}

export interface DeepgramSessionConfiguration {
  readonly model: string;
  readonly language: string;
  readonly vocabulary?: readonly string[];
  readonly endpointing?: false | { readonly silenceMs: number };
  readonly smartFormat: boolean;
  readonly punctuate: boolean;
  readonly profanityFilter?: boolean;
  readonly numerals?: boolean;
}

export function validateDeepgramConfiguration(
  value: VoiceTranscriptionOptions &
    DeepgramRealtimeSettings & { readonly model: string },
): DeepgramSessionConfiguration {
  const model = nonEmptyString(value.model, "model");
  const language = validateLanguage(value.language, model);
  const vocabulary = validateVocabulary(value.vocabulary, model);
  const endpointing = validateEndpointing(value.endpointing);
  const smartFormat = optionalBoolean(value.smartFormat, "smartFormat") ?? true;
  const punctuate = optionalBoolean(value.punctuate, "punctuate") ?? true;
  const profanityFilter = optionalBoolean(
    value.profanityFilter,
    "profanityFilter",
  );
  const numerals = optionalBoolean(value.numerals, "numerals");

  return Object.freeze({
    model,
    language,
    ...(vocabulary === undefined ? {} : { vocabulary }),
    ...(endpointing === undefined ? {} : { endpointing }),
    smartFormat,
    punctuate,
    ...(profanityFilter === undefined ? {} : { profanityFilter }),
    ...(numerals === undefined ? {} : { numerals }),
  });
}

export function createDeepgramRealtimeUrl(
  baseUrl: string,
  configuration: DeepgramSessionConfiguration,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("model", configuration.model);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(DEEPGRAM_SAMPLE_RATE));
  url.searchParams.set("channels", "1");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("vad_events", "true");
  url.searchParams.set("smart_format", String(configuration.smartFormat));
  url.searchParams.set("punctuate", String(configuration.punctuate));
  url.searchParams.set("language", configuration.language);
  for (const term of configuration.vocabulary ?? []) {
    url.searchParams.append("keyterm", term);
  }
  if (configuration.endpointing === false) {
    url.searchParams.set("endpointing", "false");
  } else if (configuration.endpointing !== undefined) {
    url.searchParams.set(
      "endpointing",
      String(configuration.endpointing.silenceMs),
    );
  }
  setOptional(url, "profanity_filter", configuration.profanityFilter);
  setOptional(url, "numerals", configuration.numerals);
  return url.href;
}

function validateLanguage(value: string | undefined, model: string): string {
  if (value === undefined) {
    if (supportsMultilingual(model)) {
      return "multi";
    }
    throw unsupportedFeature(
      `language is required for Deepgram model ${model} because it does not support multilingual transcription.`,
    );
  }
  if (typeof value !== "string") {
    throw new TypeError("language must be a valid BCP 47 language tag.");
  }
  try {
    const language = new Intl.Locale(value);
    const canonical = language.toString();
    return supportsMultilingual(model) &&
      language.language === "en" &&
      !GENERAL_NOVA_ENGLISH_LANGUAGES.has(canonical)
      ? "en"
      : canonical;
  } catch {
    throw new TypeError("language must be a valid BCP 47 language tag.");
  }
}

function validateVocabulary(
  value: readonly string[] | undefined,
  model: string,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError("vocabulary must be an array of strings.");
  }
  const vocabulary = value.map((term) => {
    if (
      typeof term !== "string" ||
      term.length === 0 ||
      term !== term.trim() ||
      /[\r\n]/u.test(term)
    ) {
      throw new TypeError(
        "Deepgram vocabulary terms must be non-empty trimmed strings without line breaks.",
      );
    }
    return term;
  });
  if (!model.startsWith("nova-3")) {
    throw unsupportedFeature(
      "Deepgram vocabulary requires a Nova-3 model because it maps to keyterm prompting.",
    );
  }
  return Object.freeze(vocabulary);
}

function supportsMultilingual(model: string): boolean {
  return (
    model === "nova-2" ||
    model === "nova-2-general" ||
    model === "nova-3" ||
    model === "nova-3-general"
  );
}

function validateEndpointing(
  value: VoiceTranscriptionOptions["endpointing"],
): DeepgramSessionConfiguration["endpointing"] {
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
      "Deepgram endpointing silenceMs must be a positive integer.",
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

function optionalBoolean(
  value: boolean | undefined,
  name: string,
): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function setOptional(url: URL, key: string, value: boolean | undefined): void {
  if (value !== undefined) {
    url.searchParams.set(key, String(value));
  }
}

function unsupportedFeature(message: string): VoiceInputError {
  return new VoiceInputError({
    code: "unsupported-feature",
    message,
    provider: "deepgram",
  });
}
