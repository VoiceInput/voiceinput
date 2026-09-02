import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1CallOptions,
  type VoiceInputProviderV1Session,
  type VoiceInputProviderV1StreamPart,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";

import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_SAMPLE_RATE,
  createElevenLabsRealtimeUrl,
  validateElevenLabsConfiguration,
  type ElevenLabsRealtimeSettings,
  type ElevenLabsSessionConfiguration,
} from "./session-config.js";

const DEFAULT_REALTIME_URL =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const DEFAULT_FINISH_TIMEOUT_MS = 4_000;
const FINISH_DRAIN_MS = 250;

export interface ElevenLabsVoiceInputProviderOptions extends ElevenLabsRealtimeSettings {
  readonly tokenEndpoint: string | URL;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocket?: typeof globalThis.WebSocket;
  readonly realtimeUrl?: string;
  readonly finishTimeoutMs?: number;
}

export function elevenlabs(
  options: ElevenLabsVoiceInputProviderOptions,
): VoiceInputProviderV1 {
  const model = factoryString(
    options.model ?? ELEVENLABS_DEFAULT_MODEL,
    "model",
  );
  const tokenEndpoint = factoryString(
    String(options.tokenEndpoint),
    "tokenEndpoint",
  );
  const realtimeUrl = factoryString(
    options.realtimeUrl ?? DEFAULT_REALTIME_URL,
    "realtimeUrl",
  );
  const finishTimeoutMs = positiveInteger(
    options.finishTimeoutMs ?? DEFAULT_FINISH_TIMEOUT_MS,
    "finishTimeoutMs",
  );
  const providerSettings: ElevenLabsRealtimeSettings = {
    ...(options.vadThreshold === undefined
      ? {}
      : { vadThreshold: options.vadThreshold }),
    ...(options.minSpeechDurationMs === undefined
      ? {}
      : { minSpeechDurationMs: options.minSpeechDurationMs }),
    ...(options.minSilenceDurationMs === undefined
      ? {}
      : { minSilenceDurationMs: options.minSilenceDurationMs }),
    ...(options.noVerbatim === undefined
      ? {}
      : { noVerbatim: options.noVerbatim }),
    ...(options.filterBackgroundAudio === undefined
      ? {}
      : { filterBackgroundAudio: options.filterBackgroundAudio }),
  };
  const validateProviderOptions = (
    transcriptionOptions: VoiceTranscriptionOptions,
  ): void => {
    try {
      validateElevenLabsConfiguration({
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

  validateProviderOptions({});

  return Object.freeze({
    specificationVersion: "v1" as const,
    provider: "elevenlabs",
    modelId: model,
    sampleRate: ELEVENLABS_SAMPLE_RATE,
    validateOptions: validateProviderOptions,
    async doOpen(callOptions: VoiceInputProviderV1CallOptions) {
      validateProviderOptions(callOptions);
      const configuration = validateElevenLabsConfiguration({
        model,
        ...providerSettings,
        ...callOptions,
      });
      return await openSession({
        abortSignal: callOptions.abortSignal,
        configuration,
        fetchImplementation: options.fetch ?? globalThis.fetch,
        finishTimeoutMs,
        realtimeUrl,
        tokenEndpoint,
        WebSocketImplementation: options.webSocket ?? globalThis.WebSocket,
      });
    },
  });
}

async function openSession(options: {
  abortSignal: AbortSignal;
  configuration: ElevenLabsSessionConfiguration;
  fetchImplementation: typeof globalThis.fetch;
  finishTimeoutMs: number;
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
    createElevenLabsRealtimeUrl(
      options.realtimeUrl,
      token,
      options.configuration,
    ),
  );
  return await createSession(
    socket,
    options.abortSignal,
    options.finishTimeoutMs,
  );
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
      message: "Unable to reach the ElevenLabs token endpoint.",
      provider: "elevenlabs",
      retryable: true,
      cause,
    });
  }
  if (!response.ok) {
    throw await tokenResponseError(response);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    throw new VoiceInputError({
      code: "token-error",
      message: "The ElevenLabs token endpoint returned invalid JSON.",
      provider: "elevenlabs",
      cause,
    });
  }
  if (!isRecord(value) || !nonEmpty(value["token"])) {
    throw new VoiceInputError({
      code: "token-error",
      message: "The ElevenLabs token endpoint returned an invalid token.",
      provider: "elevenlabs",
    });
  }
  return value["token"];
}

async function createSession(
  socket: WebSocket,
  abortSignal: AbortSignal,
  finishTimeoutMs: number,
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
      message: "Unable to initialize the ElevenLabs transcript stream.",
      provider: "elevenlabs",
    });
  }

  let hasAudio = false;
  let closed = false;
  let failed = false;
  let finishing = false;
  let finishDeferred: Deferred<void> | undefined;
  let finishSettled = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let finishDrainTimer: ReturnType<typeof setTimeout> | undefined;
  let lastInterim = "";
  const unsettledFinals: string[] = [];
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
  const settleFinish = (error?: unknown): void => {
    if (finishDeferred === undefined || finishSettled) {
      return;
    }
    finishSettled = true;
    if (finishTimer !== undefined) {
      clearTimeout(finishTimer);
      finishTimer = undefined;
    }
    if (finishDrainTimer !== undefined) {
      clearTimeout(finishDrainTimer);
      finishDrainTimer = undefined;
    }
    if (error === undefined) {
      finishDeferred.resolve(undefined);
    } else {
      finishDeferred.reject(error);
    }
  };
  const finishCleanly = (): void => {
    if (lastInterim.length > 0) {
      lastInterim = "";
      controller?.enqueue({ type: "interim", text: "" });
    }
    endSpeech();
    settleFinish();
    closeStream();
    closeSocket("finished");
  };
  const scheduleFinishDrain = (): void => {
    if (!finishing || finishSettled) {
      return;
    }
    if (finishDrainTimer !== undefined) {
      clearTimeout(finishDrainTimer);
    }
    finishDrainTimer = setTimeout(finishCleanly, FINISH_DRAIN_MS);
  };
  const fail = (error: VoiceInputError): void => {
    if (closed || failed) {
      return;
    }
    failed = true;
    settleFinish(error);
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
  const emitInterim = (text: string): void => {
    if (text.length === 0 || text === lastInterim) {
      return;
    }
    startSpeech();
    lastInterim = text;
    controller?.enqueue({ type: "interim", text });
  };
  const emitFinal = (text: string): void => {
    if (text.length === 0) {
      return;
    }
    startSpeech();
    controller?.enqueue({ type: "final", text });
  };
  const settleTranscript = (text: string): void => {
    if (text.length === 0) {
      return;
    }
    if (!unsettledFinals.includes(text)) {
      unsettledFinals.push(text);
    }
  };
  const commitTranscript = (text: string): void => {
    const hadInterim = lastInterim.length > 0;
    const settledIndex = unsettledFinals.indexOf(text);
    if (settledIndex !== -1) {
      unsettledFinals.splice(settledIndex, 1);
    }
    const preservedInterim =
      text.length === 0 || isSameTranscriptDraft(lastInterim, text)
        ? ""
        : lastInterim;
    if (preservedInterim.length === 0) {
      lastInterim = "";
    }
    emitFinal(text);
    if (text.length === 0 && hadInterim) {
      controller?.enqueue({ type: "interim", text: "" });
    } else if (preservedInterim.length > 0) {
      controller?.enqueue({ type: "interim", text: preservedInterim });
    }
    if (!finishing && lastInterim.length === 0) {
      endSpeech();
    }
  };
  const handleMessage = (event: MessageEvent): void => {
    if (closed) {
      return;
    }
    try {
      const value = JSON.parse(String(event.data)) as unknown;
      if (!isRecord(value) || !nonEmpty(value["message_type"])) {
        throw new TypeError("ElevenLabs sent an invalid Realtime event.");
      }
      const type = value["message_type"];
      if (type === "partial_transcript") {
        emitInterim(readText(value));
        if (finishDrainTimer !== undefined) {
          scheduleFinishDrain();
        }
      } else if (type === "final_transcript") {
        settleTranscript(readText(value));
        if (finishDrainTimer !== undefined) {
          scheduleFinishDrain();
        }
      } else if (type === "committed_transcript") {
        commitTranscript(readText(value));
        if (finishing) {
          scheduleFinishDrain();
        }
      } else if (elevenLabsErrorTypes.has(type)) {
        fail(normalizeRealtimeError(value));
      }
    } catch (cause) {
      fail(
        new VoiceInputError({
          code: "provider-error",
          message: "ElevenLabs sent an invalid Realtime event.",
          provider: "elevenlabs",
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
      if (finishing) {
        finishCleanly();
        return;
      }
      closeStream();
    } else {
      fail(
        new VoiceInputError({
          code: "network-error",
          message: "The ElevenLabs Realtime connection closed unexpectedly.",
          provider: "elevenlabs",
          retryable: true,
          cause: event,
        }),
      );
    }
  };
  function abort(): void {
    if (closed) {
      return;
    }
    settleFinish(
      abortSignal.reason ??
        new VoiceInputError({
          code: "provider-error",
          message: "The ElevenLabs Realtime session was aborted.",
          provider: "elevenlabs",
        }),
    );
    closeStream();
    closeSocket("aborted");
  }

  socket.addEventListener("message", handleMessage);
  socket.addEventListener("close", handleClose);
  socket.addEventListener("error", () => {
    fail(
      new VoiceInputError({
        code: "network-error",
        message: "The ElevenLabs Realtime connection failed.",
        provider: "elevenlabs",
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
      hasAudio = true;
      sendJson(socket, {
        message_type: "input_audio_chunk",
        audio_base_64: encodePcm16(chunk),
        commit: false,
        sample_rate: ELEVENLABS_SAMPLE_RATE,
      });
    },
    finish() {
      if (finishDeferred !== undefined) {
        return finishDeferred.promise;
      }
      if (closed) {
        return;
      }
      finishing = true;
      finishDeferred = createDeferred<void>();
      if (!hasAudio) {
        finishCleanly();
        return finishDeferred.promise;
      }
      try {
        sendJson(socket, {
          message_type: "input_audio_chunk",
          audio_base_64: "",
          commit: true,
          sample_rate: ELEVENLABS_SAMPLE_RATE,
        });
      } catch (cause) {
        fail(
          VoiceInputError.isInstance(cause)
            ? cause
            : new VoiceInputError({
                code: "network-error",
                message: "Unable to commit the ElevenLabs transcript.",
                provider: "elevenlabs",
                retryable: true,
                cause,
              }),
        );
        return finishDeferred.promise;
      }
      finishTimer = setTimeout(() => {
        fail(
          new VoiceInputError({
            code: "network-error",
            message: `ElevenLabs did not commit the final transcript within ${finishTimeoutMs}ms.`,
            provider: "elevenlabs",
            retryable: true,
          }),
        );
      }, finishTimeoutMs);
      return finishDeferred.promise;
    },
    abort,
  };
}

function isSameTranscriptDraft(interim: string, final: string): boolean {
  if (interim.length === 0 || final.length === 0) {
    return false;
  }
  const draft = normalizeTranscriptForComparison(interim);
  const settled = normalizeTranscriptForComparison(final);
  return (
    draft.length > 0 &&
    settled.length > 0 &&
    (draft.startsWith(settled) || settled.startsWith(draft))
  );
}

function normalizeTranscriptForComparison(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

const elevenLabsErrorTypes = new Set([
  "auth_error",
  "quota_exceeded",
  "transcriber_error",
  "input_error",
  "invalid_request",
  "error",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
]);

function normalizeRealtimeError(
  value: Record<string, unknown>,
): VoiceInputError {
  const type = String(value["message_type"]);
  const rateLimited =
    type === "rate_limited" ||
    type === "quota_exceeded" ||
    type === "commit_throttled";
  const retryable =
    rateLimited || type === "queue_overflow" || type === "resource_exhausted";
  const code =
    type === "auth_error"
      ? "unauthorized"
      : rateLimited
        ? "rate-limited"
        : type === "input_error" || type === "chunk_size_exceeded"
          ? "audio-error"
          : "provider-error";
  return new VoiceInputError({
    code,
    message:
      typeof value["error"] === "string"
        ? value["error"]
        : `ElevenLabs Realtime reported ${type}.`,
    provider: "elevenlabs",
    retryable,
    cause: value,
  });
}

function invalidConfiguration(cause: unknown): VoiceInputError {
  return new VoiceInputError({
    code: "invalid-configuration",
    message:
      cause instanceof Error
        ? cause.message
        : "Invalid ElevenLabs transcription options.",
    provider: "elevenlabs",
    cause,
  });
}

function readText(value: Record<string, unknown>): string {
  if (typeof value["text"] !== "string") {
    throw new TypeError("text must be a string.");
  }
  return value["text"];
}

function requireBrowserFunction(value: unknown, feature: string): void {
  if (typeof value !== "function") {
    throw new VoiceInputError({
      code: "unsupported-browser",
      message: `ElevenLabs voice input requires browser ${feature} support.`,
      provider: "elevenlabs",
    });
  }
}

function factoryString(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw invalidConfiguration(new TypeError(`${name} must be non-empty.`));
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidConfiguration(
      new TypeError(`${name} must be a positive safe integer.`),
    );
  }
  return value;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  return { promise, resolve, reject };
}

async function tokenResponseError(
  response: Response,
): Promise<VoiceInputError> {
  const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
  if (response.status === 401 || response.status === 403) {
    return new VoiceInputError({
      code: "unauthorized",
      message: "The ElevenLabs token endpoint rejected this request.",
      provider: "elevenlabs",
    });
  }
  if (response.status === 429) {
    return new VoiceInputError({
      code: "rate-limited",
      message: "The ElevenLabs token endpoint rate limit was exceeded.",
      provider: "elevenlabs",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  const safeError = await readSafeTokenError(response);
  if (safeError !== undefined) {
    return new VoiceInputError({ ...safeError, provider: "elevenlabs" });
  }
  return new VoiceInputError({
    code: "token-error",
    message: "The ElevenLabs token endpoint did not issue a token.",
    provider: "elevenlabs",
    retryable: response.status >= 500,
  });
}

async function readSafeTokenError(response: Response): Promise<
  | {
      code: "invalid-configuration" | "unsupported-feature";
      message: string;
    }
  | undefined
> {
  if (
    response.status !== 400 ||
    response.headers.get("X-VoiceInput-Error") !== "1" ||
    response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !==
      "application/json"
  ) {
    return undefined;
  }
  const text = await readBoundedErrorText(response);
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    const error = isRecord(value) ? value["error"] : undefined;
    if (
      !isRecord(error) ||
      (error["code"] !== "invalid-configuration" &&
        error["code"] !== "unsupported-feature") ||
      typeof error["message"] !== "string" ||
      error["message"].length === 0 ||
      error["message"].length > 1_000
    ) {
      return undefined;
    }
    return { code: error["code"], message: error["message"] };
  } catch {
    return undefined;
  }
}

async function readBoundedErrorText(
  response: Response,
): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return undefined;
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytesRead += value.byteLength;
      if (bytesRead > 4_096) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return undefined;
  }
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
          message: "Unable to open the ElevenLabs Realtime connection.",
          provider: "elevenlabs",
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
      message: "Unable to send data to ElevenLabs Realtime.",
      provider: "elevenlabs",
      retryable: true,
      cause,
    });
  }
}

function encodePcm16(chunk: Int16Array): string {
  const bytes = new Uint8Array(
    chunk.buffer,
    chunk.byteOffset,
    chunk.byteLength,
  );
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
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

export { ELEVENLABS_DEFAULT_MODEL } from "./session-config.js";
