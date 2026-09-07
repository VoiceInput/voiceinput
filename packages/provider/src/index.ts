const voiceInputErrorMarker = Symbol.for(
  "@voiceinput/provider/VoiceInputError",
);

export type VoiceInputErrorCode =
  | "unsupported-browser"
  | "user-activation-required"
  | "permission-denied"
  | "device-not-found"
  | "device-busy"
  | "unauthorized"
  | "rate-limited"
  | "token-error"
  | "network-error"
  | "provider-error"
  | "unsupported-feature"
  | "invalid-configuration"
  | "audio-error"
  | "transform-error";

export interface VoiceInputErrorOptions {
  code: VoiceInputErrorCode;
  message: string;
  provider?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

export class VoiceInputError extends Error {
  readonly code: VoiceInputErrorCode;
  readonly provider: string | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(options: VoiceInputErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "VoiceInputError";
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;

    Object.defineProperty(this, voiceInputErrorMarker, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  }

  static isInstance(value: unknown): value is VoiceInputError {
    return (
      typeof value === "object" &&
      value !== null &&
      voiceInputErrorMarker in value &&
      (value as Record<PropertyKey, unknown>)[voiceInputErrorMarker] === true
    );
  }
}

/** Returns a stable, user-facing message for a normalized VoiceInput error. */
export function getVoiceInputErrorMessage(error: VoiceInputError): string {
  switch (error.code) {
    case "unsupported-browser":
      return "Voice input is not supported in this browser.";
    case "user-activation-required":
      return "Select the microphone button again to start voice input.";
    case "permission-denied":
      return "Microphone access was denied. Check your browser and system permissions.";
    case "device-not-found":
      return "No microphone was found. Connect one and try again.";
    case "device-busy":
      return "The microphone is being used by another application.";
    case "unauthorized":
      return "Voice input could not be authorized. Sign in again and retry.";
    case "rate-limited":
      return "Too many voice input requests. Wait a moment and try again.";
    case "token-error":
    case "network-error":
      return "Voice input could not connect. Check your connection and try again.";
    case "provider-error":
      return "The transcription service could not process the recording. Try again.";
    case "unsupported-feature":
      return "This voice input option is not supported.";
    case "invalid-configuration":
      return "Voice input is not configured correctly.";
    case "audio-error":
      return "The microphone audio could not be processed. Try again.";
    case "transform-error":
      return "The transcript could not be processed. Try again.";
    default:
      return "Voice input failed. Try again.";
  }
}

/** Reports an exception without silently swallowing it when reportError is absent. */
export function reportUnhandledError(error: unknown): void {
  const reportError = (
    globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    }
  ).reportError;

  if (typeof reportError === "function") {
    reportError(error);
  } else {
    queueMicrotask(() => {
      throw error;
    });
  }
}

export interface VoiceEndpointingOptions {
  silenceMs: number;
}

export interface VoiceTranscriptionOptions {
  language?: string;
  vocabulary?: readonly string[];
  endpointing?: false | VoiceEndpointingOptions;
}

export interface VoiceInputProviderV1CallOptions extends VoiceTranscriptionOptions {
  abortSignal: AbortSignal;
}

export type VoiceInputProviderV1StreamPart =
  | { type: "interim"; text: string; segmentId?: string }
  | { type: "final"; text: string; segmentId?: string }
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "error"; error: VoiceInputError };

export interface VoiceInputProviderV1Session {
  readonly stream: ReadableStream<VoiceInputProviderV1StreamPart>;
  sendAudio(chunk: Int16Array): PromiseLike<void> | void;
  finish(): PromiseLike<void> | void;
  abort(reason?: unknown): void;
}

export interface VoiceInputProviderV1 {
  readonly specificationVersion: "v1";
  readonly provider: string;
  readonly modelId: string;
  readonly sampleRate: number;
  validateOptions(options: VoiceTranscriptionOptions): void;
  doOpen(
    options: VoiceInputProviderV1CallOptions,
  ): PromiseLike<VoiceInputProviderV1Session>;
}
