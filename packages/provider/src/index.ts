const voiceInputErrorMarker = Symbol.for(
  "@voiceinput/provider/VoiceInputError",
);

export type VoiceInputErrorCode =
  | "unsupported-browser"
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
