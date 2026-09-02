import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1CallOptions,
  type VoiceInputProviderV1Session,
  type VoiceInputProviderV1StreamPart,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";

import {
  OPENAI_DEFAULT_MODEL,
  OPENAI_SAMPLE_RATE,
  createOpenAITranscriptionSession,
  validateOpenAITokenRequest,
  type OpenAITokenRequest,
} from "./session-config.js";

const DEFAULT_REALTIME_URL = "wss://api.openai.com/v1/realtime";

export interface OpenAIVoiceInputProviderOptions {
  readonly tokenEndpoint: string | URL;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocket?: typeof globalThis.WebSocket;
  readonly realtimeUrl?: string;
}

interface OpenAICredential {
  value: string;
  expires_at: number;
}

interface TranscriptState {
  delta: string;
  final?: string;
  lastEmittedInterim?: string;
}

export function openai(
  options: OpenAIVoiceInputProviderOptions,
): VoiceInputProviderV1 {
  const model = validateFactoryString(
    options.model ?? OPENAI_DEFAULT_MODEL,
    "model",
  );
  const tokenEndpoint = validateFactoryString(
    String(options.tokenEndpoint),
    "tokenEndpoint",
  );
  const realtimeUrl = validateFactoryString(
    options.realtimeUrl ?? DEFAULT_REALTIME_URL,
    "realtimeUrl",
  );
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const WebSocketImplementation = options.webSocket ?? globalThis.WebSocket;
  const validateProviderOptions = (
    transcriptionOptions: VoiceTranscriptionOptions,
  ): void => validateOptions(transcriptionOptions, model);

  return Object.freeze({
    specificationVersion: "v1" as const,
    provider: "openai",
    modelId: model,
    sampleRate: OPENAI_SAMPLE_RATE,
    validateOptions: validateProviderOptions,
    async doOpen(callOptions: VoiceInputProviderV1CallOptions) {
      validateProviderOptions(callOptions);
      return await openSession({
        callOptions,
        fetchImplementation,
        model,
        realtimeUrl,
        tokenEndpoint,
        WebSocketImplementation,
      });
    },
  });
}

function validateOptions(
  options: VoiceTranscriptionOptions,
  model: string,
): void {
  try {
    validateOpenAITokenRequest({
      model,
      ...options,
    });
  } catch (cause) {
    if (VoiceInputError.isInstance(cause)) {
      throw cause;
    }
    throw new VoiceInputError({
      code: "invalid-configuration",
      message:
        cause instanceof Error
          ? cause.message
          : "Invalid OpenAI transcription options.",
      provider: "openai",
      cause,
    });
  }
}

async function openSession(options: {
  callOptions: VoiceInputProviderV1CallOptions;
  fetchImplementation: typeof globalThis.fetch;
  model: string;
  realtimeUrl: string;
  tokenEndpoint: string;
  WebSocketImplementation: typeof globalThis.WebSocket;
}): Promise<VoiceInputProviderV1Session> {
  const { abortSignal } = options.callOptions;
  throwIfAborted(abortSignal);
  if (typeof options.fetchImplementation !== "function") {
    throw unsupportedBrowserFeature("fetch");
  }
  if (typeof options.WebSocketImplementation !== "function") {
    throw unsupportedBrowserFeature("WebSocket");
  }
  const tokenRequest = validateOpenAITokenRequest({
    model: options.model,
    ...options.callOptions,
  });
  const credential = await requestCredential(
    options.fetchImplementation,
    options.tokenEndpoint,
    tokenRequest,
    abortSignal,
  );
  throwIfAborted(abortSignal);

  const socket = new options.WebSocketImplementation(options.realtimeUrl, [
    "realtime",
    `openai-insecure-api-key.${credential.value}`,
  ]);
  return await createSession(socket, tokenRequest, abortSignal);
}

async function requestCredential(
  fetchImplementation: typeof globalThis.fetch,
  tokenEndpoint: string,
  tokenRequest: OpenAITokenRequest,
  abortSignal: AbortSignal,
): Promise<OpenAICredential> {
  let response: Response;
  try {
    response = await fetchImplementation(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenRequest),
      credentials: "same-origin",
      signal: abortSignal,
    });
  } catch (cause) {
    throwIfAborted(abortSignal);
    throw new VoiceInputError({
      code: "network-error",
      message: "Unable to reach the OpenAI token endpoint.",
      provider: "openai",
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
      message: "The OpenAI token endpoint returned invalid JSON.",
      provider: "openai",
      cause,
    });
  }
  if (
    !isRecord(value) ||
    typeof value["value"] !== "string" ||
    value["value"].length === 0 ||
    typeof value["expires_at"] !== "number" ||
    !Number.isFinite(value["expires_at"])
  ) {
    throw new VoiceInputError({
      code: "token-error",
      message: "The OpenAI token endpoint returned an invalid credential.",
      provider: "openai",
    });
  }
  return { value: value["value"], expires_at: value["expires_at"] };
}

async function tokenResponseError(
  response: Response,
): Promise<VoiceInputError> {
  const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
  if (response.status === 401 || response.status === 403) {
    return new VoiceInputError({
      code: "unauthorized",
      message: "The OpenAI token endpoint rejected this request.",
      provider: "openai",
    });
  }
  if (response.status === 429) {
    return new VoiceInputError({
      code: "rate-limited",
      message: "The OpenAI token endpoint rate limit was exceeded.",
      provider: "openai",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  const safeError = await readSafeTokenError(response);
  if (safeError !== undefined) {
    return new VoiceInputError({ ...safeError, provider: "openai" });
  }
  return new VoiceInputError({
    code: "token-error",
    message: "The OpenAI token endpoint did not issue a credential.",
    provider: "openai",
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

async function createSession(
  socket: WebSocket,
  tokenRequest: OpenAITokenRequest,
  abortSignal: AbortSignal,
): Promise<VoiceInputProviderV1Session> {
  let streamController:
    ReadableStreamDefaultController<VoiceInputProviderV1StreamPart> | undefined;
  const stream = new ReadableStream<VoiceInputProviderV1StreamPart>({
    start(controller) {
      streamController = controller;
    },
  });
  if (streamController === undefined) {
    throw new VoiceInputError({
      code: "provider-error",
      message: "Unable to initialize the OpenAI transcript stream.",
      provider: "openai",
    });
  }

  const transcripts = new Map<string, TranscriptState>();
  const transcriptOrder: string[] = [];
  let audioSent = false;
  let closed = false;
  let failed = false;
  let finishing = false;
  let manualCommitPending = false;
  let vadCommitPending = false;
  const manualCommitEventId = "voiceinput-finish";

  const closeStream = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    abortSignal.removeEventListener("abort", abort);
    streamController?.close();
  };

  const closeSocket = (reason: "aborted" | "finished"): void => {
    if (socket.readyState === 1 || socket.readyState === 0) {
      socket.close(1000, reason);
    }
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
    streamController?.enqueue({ type: "error", error });
    closeStream();
    closeSocket("aborted");
  };

  const maybeFinish = (): void => {
    if (
      finishing &&
      !manualCommitPending &&
      !vadCommitPending &&
      transcripts.size === 0
    ) {
      finishCleanly();
    }
  };

  const emitInterim = (state: TranscriptState): void => {
    if (state.delta && state.delta !== state.lastEmittedInterim) {
      state.lastEmittedInterim = state.delta;
      streamController?.enqueue({ type: "interim", text: state.delta });
    }
  };

  const flushFinals = (): void => {
    while (transcriptOrder.length > 0) {
      const itemId = transcriptOrder[0] as string;
      const state = transcripts.get(itemId);
      if (state?.final === undefined) {
        if (state !== undefined) {
          emitInterim(state);
        }
        break;
      }
      transcriptOrder.shift();
      transcripts.delete(itemId);
      streamController?.enqueue({ type: "final", text: state.final });
    }
    maybeFinish();
  };

  const ensureTranscript = (itemId: string): TranscriptState => {
    let state = transcripts.get(itemId);
    if (state === undefined) {
      state = { delta: "" };
      transcripts.set(itemId, state);
      transcriptOrder.push(itemId);
    }
    return state;
  };

  const handleMessage = (event: MessageEvent): void => {
    if (closed) {
      return;
    }
    try {
      const value = JSON.parse(String(event.data)) as unknown;
      if (!isRecord(value) || typeof value["type"] !== "string") {
        throw new TypeError("OpenAI sent an invalid Realtime event.");
      }
      const type = value["type"];
      if (type === "input_audio_buffer.speech_started") {
        streamController?.enqueue({ type: "speech-start" });
        return;
      }
      if (type === "input_audio_buffer.speech_stopped") {
        vadCommitPending = true;
        streamController?.enqueue({ type: "speech-end" });
        return;
      }
      if (type === "input_audio_buffer.committed") {
        const itemId = readString(value, "item_id");
        manualCommitPending = false;
        vadCommitPending = false;
        ensureTranscript(itemId);
        flushFinals();
        return;
      }
      if (type === "conversation.item.input_audio_transcription.delta") {
        const itemId = readString(value, "item_id");
        const state = ensureTranscript(itemId);
        state.delta += readString(value, "delta");
        if (transcriptOrder[0] === itemId) {
          emitInterim(state);
        }
        return;
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const itemId = readString(value, "item_id");
        ensureTranscript(itemId).final = readString(value, "transcript");
        flushFinals();
        return;
      }
      if (type === "conversation.item.input_audio_transcription.failed") {
        fail(normalizeTranscriptionFailure(value));
        return;
      }
      if (type === "error") {
        if (isExpectedEmptyCommitError(value, manualCommitEventId)) {
          manualCommitPending = false;
          maybeFinish();
          return;
        }
        fail(normalizeRealtimeError(value));
      }
    } catch (cause) {
      fail(
        new VoiceInputError({
          code: "provider-error",
          message: "OpenAI sent an invalid Realtime event.",
          provider: "openai",
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
      fail(
        new VoiceInputError({
          code: "network-error",
          message: "The OpenAI Realtime connection closed unexpectedly.",
          provider: "openai",
          retryable: true,
          cause: event,
        }),
      );
    }
  };

  const abort = (): void => {
    if (closed) {
      return;
    }
    closeStream();
    closeSocket("aborted");
  };

  socket.addEventListener("message", handleMessage);
  socket.addEventListener("close", handleClose);
  socket.addEventListener("error", () => {
    fail(
      new VoiceInputError({
        code: "network-error",
        message: "The OpenAI Realtime connection failed.",
        provider: "openai",
        retryable: true,
      }),
    );
  });
  abortSignal.addEventListener("abort", abort, { once: true });

  await waitForOpen(socket, abortSignal);
  sendEvent(socket, {
    type: "session.update",
    session: createOpenAITranscriptionSession(tokenRequest),
  });

  return {
    stream,
    sendAudio(chunk) {
      if (closed || finishing) {
        return;
      }
      audioSent ||= chunk.length > 0;
      if (chunk.length > 0) {
        sendEvent(socket, {
          type: "input_audio_buffer.append",
          audio: encodePcm16(chunk),
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
      if (!vadCommitPending) {
        manualCommitPending = true;
        sendEvent(socket, {
          type: "input_audio_buffer.commit",
          event_id: manualCommitEventId,
        });
      }
      maybeFinish();
    },
    abort,
  };
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
          message: "Unable to open the OpenAI Realtime connection.",
          provider: "openai",
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

function sendEvent(socket: WebSocket, event: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (cause) {
    throw new VoiceInputError({
      code: "network-error",
      message: "Unable to send data to OpenAI Realtime.",
      provider: "openai",
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

function normalizeRealtimeError(
  value: Record<string, unknown>,
): VoiceInputError {
  const error = isRecord(value["error"]) ? value["error"] : value;
  const code = typeof error["code"] === "string" ? error["code"] : "";
  const message =
    typeof error["message"] === "string"
      ? error["message"]
      : "OpenAI Realtime reported an error.";
  const rateLimited = code.includes("rate_limit");
  return new VoiceInputError({
    code: rateLimited ? "rate-limited" : "provider-error",
    message,
    provider: "openai",
    retryable: rateLimited || code.includes("server_error"),
    cause: value,
  });
}

function normalizeTranscriptionFailure(
  value: Record<string, unknown>,
): VoiceInputError {
  const error = isRecord(value["error"]) ? value["error"] : {};
  return new VoiceInputError({
    code: "provider-error",
    message:
      typeof error["message"] === "string"
        ? error["message"]
        : "OpenAI could not transcribe an audio turn.",
    provider: "openai",
    retryable:
      typeof error["code"] === "string" &&
      error["code"].includes("server_error"),
    cause: value,
  });
}

function isExpectedEmptyCommitError(
  value: Record<string, unknown>,
  eventId: string,
): boolean {
  const error = isRecord(value["error"]) ? value["error"] : {};
  return (
    error["code"] === "input_audio_buffer_commit_empty" &&
    error["event_id"] === eventId
  );
}

function readString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string") {
    throw new TypeError(`${key} must be a string.`);
  }
  return result;
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

function validateFactoryString(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message: `${name} must be a non-empty string.`,
      provider: "openai",
    });
  }
  return value;
}

function unsupportedBrowserFeature(feature: string): VoiceInputError {
  return new VoiceInputError({
    code: "unsupported-browser",
    message: `OpenAI voice input requires browser ${feature} support.`,
    provider: "openai",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { OPENAI_DEFAULT_MODEL } from "./session-config.js";
