import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1CallOptions,
  type VoiceInputProviderV1Session,
  type VoiceInputProviderV1StreamPart,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";

import {
  DEEPGRAM_DEFAULT_MODEL,
  DEEPGRAM_SAMPLE_RATE,
  createDeepgramRealtimeUrl,
  validateDeepgramConfiguration,
  type DeepgramRealtimeSettings,
  type DeepgramSessionConfiguration,
} from "./session-config.js";

const DEFAULT_REALTIME_URL = "wss://api.deepgram.com/v1/listen";

export interface DeepgramVoiceInputProviderOptions extends DeepgramRealtimeSettings {
  readonly tokenEndpoint: string | URL;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocket?: typeof globalThis.WebSocket;
  readonly realtimeUrl?: string;
}

export function deepgram(
  options: DeepgramVoiceInputProviderOptions,
): VoiceInputProviderV1 {
  const model = factoryString(options.model ?? DEEPGRAM_DEFAULT_MODEL, "model");
  const tokenEndpoint = factoryString(
    String(options.tokenEndpoint),
    "tokenEndpoint",
  );
  const realtimeUrl = factoryString(
    options.realtimeUrl ?? DEFAULT_REALTIME_URL,
    "realtimeUrl",
  );
  const providerSettings: DeepgramRealtimeSettings = {
    ...(options.smartFormat === undefined
      ? {}
      : { smartFormat: options.smartFormat }),
    ...(options.punctuate === undefined
      ? {}
      : { punctuate: options.punctuate }),
    ...(options.profanityFilter === undefined
      ? {}
      : { profanityFilter: options.profanityFilter }),
    ...(options.numerals === undefined ? {} : { numerals: options.numerals }),
  };
  const validateProviderOptions = (
    transcriptionOptions: VoiceTranscriptionOptions,
  ): void => {
    try {
      validateDeepgramConfiguration({
        model,
        ...providerSettings,
        ...transcriptionOptions,
      });
    } catch (cause) {
      if (VoiceInputError.isInstance(cause)) {
        throw cause;
      }
      throw invalidConfiguration(cause);
    }
  };

  return Object.freeze({
    specificationVersion: "v1" as const,
    provider: "deepgram",
    modelId: model,
    sampleRate: DEEPGRAM_SAMPLE_RATE,
    validateOptions: validateProviderOptions,
    async doOpen(callOptions: VoiceInputProviderV1CallOptions) {
      validateProviderOptions(callOptions);
      const configuration = validateDeepgramConfiguration({
        model,
        ...providerSettings,
        ...callOptions,
      });
      return await openSession({
        abortSignal: callOptions.abortSignal,
        configuration,
        fetchImplementation: options.fetch ?? globalThis.fetch,
        realtimeUrl,
        tokenEndpoint,
        WebSocketImplementation: options.webSocket ?? globalThis.WebSocket,
      });
    },
  });
}

async function openSession(options: {
  abortSignal: AbortSignal;
  configuration: DeepgramSessionConfiguration;
  fetchImplementation: typeof globalThis.fetch;
  realtimeUrl: string;
  tokenEndpoint: string;
  WebSocketImplementation: typeof globalThis.WebSocket;
}): Promise<VoiceInputProviderV1Session> {
  throwIfAborted(options.abortSignal);
  requireBrowserFunction(options.fetchImplementation, "fetch");
  requireBrowserFunction(options.WebSocketImplementation, "WebSocket");
  const token = await requestToken(
    options.fetchImplementation,
    options.tokenEndpoint,
    options.configuration.model,
    options.abortSignal,
  );
  throwIfAborted(options.abortSignal);
  const socket = new options.WebSocketImplementation(
    createDeepgramRealtimeUrl(options.realtimeUrl, options.configuration),
    ["bearer", token],
  );
  return await createSession(socket, options.abortSignal);
}

async function requestToken(
  fetchImplementation: typeof globalThis.fetch,
  tokenEndpoint: string,
  model: string,
  abortSignal: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImplementation(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      credentials: "same-origin",
      signal: abortSignal,
    });
  } catch (cause) {
    throwIfAborted(abortSignal);
    throw new VoiceInputError({
      code: "network-error",
      message: "Unable to reach the Deepgram token endpoint.",
      provider: "deepgram",
      retryable: true,
      cause,
    });
  }
  if (!response.ok) {
    throw tokenResponseError(response);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    throw new VoiceInputError({
      code: "token-error",
      message: "The Deepgram token endpoint returned invalid JSON.",
      provider: "deepgram",
      cause,
    });
  }
  if (!isRecord(value) || !nonEmpty(value["access_token"])) {
    throw new VoiceInputError({
      code: "token-error",
      message: "The Deepgram token endpoint returned an invalid token.",
      provider: "deepgram",
    });
  }
  return value["access_token"];
}

async function createSession(
  socket: WebSocket,
  abortSignal: AbortSignal,
): Promise<VoiceInputProviderV1Session> {
  let controller:
    ReadableStreamDefaultController<VoiceInputProviderV1StreamPart> | undefined;
  const stream = new ReadableStream<VoiceInputProviderV1StreamPart>({
    start(value) {
      controller = value;
    },
  });
  if (controller === undefined) {
    throw new VoiceInputError({
      code: "provider-error",
      message: "Unable to initialize the Deepgram transcript stream.",
      provider: "deepgram",
    });
  }

  let audioSent = false;
  let closed = false;
  let failed = false;
  let finishing = false;
  let lastFinalKey = "";
  let lastInterim = "";
  let speechActive = false;

  const closeSocket = (reason: "aborted" | "finished"): void => {
    if (socket.readyState === 0 || socket.readyState === 1) {
      socket.close(1000, reason);
    }
  };
  const closeStream = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    abortSignal.removeEventListener("abort", abort);
    controller?.close();
  };
  const finishCleanly = (): void => {
    closeStream();
    closeSocket("finished");
  };
  const fail = (error: VoiceInputError): void => {
    if (closed || failed) {
      return;
    }
    failed = true;
    controller?.enqueue({ type: "error", error });
    closeStream();
    closeSocket("aborted");
  };
  const startSpeech = (): void => {
    if (!speechActive) {
      speechActive = true;
      controller?.enqueue({ type: "speech-start" });
    }
  };
  const endSpeech = (): void => {
    if (speechActive) {
      speechActive = false;
      controller?.enqueue({ type: "speech-end" });
    }
  };
  const handleResults = (value: Record<string, unknown>): void => {
    const channel = value["channel"];
    if (!isRecord(channel) || !Array.isArray(channel["alternatives"])) {
      throw new TypeError("Deepgram Results did not contain alternatives.");
    }
    const alternative = channel["alternatives"][0];
    if (
      !isRecord(alternative) ||
      typeof alternative["transcript"] !== "string"
    ) {
      throw new TypeError("Deepgram Results did not contain a transcript.");
    }
    const text = alternative["transcript"];
    const isFinal = value["is_final"] === true;
    if (text.length > 0) {
      startSpeech();
      if (isFinal) {
        const finalKey = `${String(value["start"])}:${String(value["duration"])}:${text}`;
        if (finalKey !== lastFinalKey) {
          lastFinalKey = finalKey;
          controller?.enqueue({ type: "final", text });
        }
        lastInterim = "";
      } else if (text !== lastInterim) {
        lastInterim = text;
        controller?.enqueue({ type: "interim", text });
      }
    }
    if (value["speech_final"] === true) {
      endSpeech();
    }
  };
  const handleMessage = (event: MessageEvent): void => {
    try {
      const value = JSON.parse(String(event.data)) as unknown;
      if (!isRecord(value) || !nonEmpty(value["type"])) {
        throw new TypeError("Deepgram sent an invalid streaming event.");
      }
      const type = value["type"];
      if (type === "Results") {
        handleResults(value);
      } else if (type === "SpeechStarted") {
        startSpeech();
      } else if (type === "UtteranceEnd") {
        endSpeech();
      } else if (type === "Error") {
        fail(normalizeMessageError(value));
      }
    } catch (cause) {
      fail(
        new VoiceInputError({
          code: "provider-error",
          message: "Deepgram sent an invalid streaming event.",
          provider: "deepgram",
          cause,
        }),
      );
    }
  };
  const handleClose = (event: CloseEvent): void => {
    if (closed) {
      return;
    }
    if (event.code === 1000) {
      closeStream();
    } else {
      fail(normalizeCloseError(event));
    }
  };
  function abort(): void {
    if (closed) {
      return;
    }
    closeStream();
    closeSocket("aborted");
  }

  socket.addEventListener("message", handleMessage);
  socket.addEventListener("close", handleClose);
  socket.addEventListener("error", () => {
    fail(
      new VoiceInputError({
        code: "network-error",
        message: "The Deepgram streaming connection failed.",
        provider: "deepgram",
        retryable: true,
      }),
    );
  });
  abortSignal.addEventListener("abort", abort, { once: true });
  await waitForOpen(socket, abortSignal);

  return {
    stream,
    sendAudio(chunk) {
      if (closed || finishing || chunk.length === 0) {
        return;
      }
      audioSent = true;
      try {
        socket.send(new Int16Array(chunk).buffer);
      } catch (cause) {
        throw new VoiceInputError({
          code: "network-error",
          message: "Unable to send audio to Deepgram.",
          provider: "deepgram",
          retryable: true,
          cause,
        });
      }
    },
    finish() {
      if (closed || finishing) {
        return;
      }
      finishing = true;
      if (!audioSent) {
        finishCleanly();
        return;
      }
      sendJson(socket, { type: "CloseStream" });
    },
    abort,
  };
}

function normalizeMessageError(
  value: Record<string, unknown>,
): VoiceInputError {
  const code = typeof value["code"] === "string" ? value["code"] : "";
  const description =
    typeof value["description"] === "string"
      ? value["description"]
      : typeof value["message"] === "string"
        ? value["message"]
        : "";
  const source = `${code} ${description}`;
  const rateLimited = /rate|quota|429/iu.test(source);
  const unauthorized = /auth|unauthorized|401|403/iu.test(source);
  return new VoiceInputError({
    code: unauthorized
      ? "unauthorized"
      : rateLimited
        ? "rate-limited"
        : "provider-error",
    message: description || "Deepgram reported a streaming error.",
    provider: "deepgram",
    retryable: rateLimited || /internal|unavailable/iu.test(source),
    cause: value,
  });
}

function normalizeCloseError(event: CloseEvent): VoiceInputError {
  const reason = event.reason ?? "";
  const rateLimited = event.code === 1013 || /rate|quota|429/iu.test(reason);
  const unauthorized = /auth|unauthorized|401|403/iu.test(reason);
  const invalidAudio =
    event.code === 1008 && /data|audio|decode/iu.test(reason);
  return new VoiceInputError({
    code: unauthorized
      ? "unauthorized"
      : rateLimited
        ? "rate-limited"
        : invalidAudio
          ? "audio-error"
          : "network-error",
    message: "The Deepgram streaming connection closed unexpectedly.",
    provider: "deepgram",
    retryable: rateLimited || (!unauthorized && !invalidAudio),
    cause: event,
  });
}

function invalidConfiguration(cause: unknown): VoiceInputError {
  return new VoiceInputError({
    code: "invalid-configuration",
    message:
      cause instanceof Error
        ? cause.message
        : "Invalid Deepgram transcription options.",
    provider: "deepgram",
    cause,
  });
}

function requireBrowserFunction(value: unknown, feature: string): void {
  if (typeof value !== "function") {
    throw new VoiceInputError({
      code: "unsupported-browser",
      message: `Deepgram voice input requires browser ${feature} support.`,
      provider: "deepgram",
    });
  }
}

function factoryString(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw invalidConfiguration(new TypeError(`${name} must be non-empty.`));
  }
  return value;
}

function tokenResponseError(response: Response): VoiceInputError {
  const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
  if (response.status === 401 || response.status === 403) {
    return new VoiceInputError({
      code: "unauthorized",
      message: "The Deepgram token endpoint rejected this request.",
      provider: "deepgram",
    });
  }
  if (response.status === 429) {
    return new VoiceInputError({
      code: "rate-limited",
      message: "The Deepgram token endpoint rate limit was exceeded.",
      provider: "deepgram",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  return new VoiceInputError({
    code: "token-error",
    message: "The Deepgram token endpoint did not issue a token.",
    provider: "deepgram",
    retryable: response.status >= 500,
  });
}

function waitForOpen(
  socket: WebSocket,
  abortSignal: AbortSignal,
): Promise<void> {
  if (socket.readyState === 1) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      abortSignal.removeEventListener("abort", handleAbort);
    };
    const handleOpen = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (event: Event): void => {
      cleanup();
      reject(
        new VoiceInputError({
          code: "network-error",
          message: "Unable to open the Deepgram streaming connection.",
          provider: "deepgram",
          retryable: true,
          cause: event,
        }),
      );
    };
    const handleAbort = (): void => {
      cleanup();
      reject(abortSignal.reason);
    };
    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
    abortSignal.addEventListener("abort", handleAbort, { once: true });
  });
}

function sendJson(socket: WebSocket, value: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(value));
  } catch (cause) {
    throw new VoiceInputError({
      code: "network-error",
      message: "Unable to send data to Deepgram.",
      provider: "deepgram",
      retryable: true,
      cause,
    });
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { DEEPGRAM_DEFAULT_MODEL } from "./session-config.js";
