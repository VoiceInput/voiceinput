import {
  VoiceInputError,
  getVoiceInputErrorMessage,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1StreamPart,
} from "@voiceinput/provider";
import { sendWithBackpressure } from "@voiceinput/provider/transport";
import { DEMO_PROTOCOL, DEMO_SAMPLE_RATE } from "./demo-config";

const MAX_DEMO_RETRY_AFTER_MS = 86_400_000;
const RATE_LIMIT_MESSAGES = new Set([
  "Please wait a moment before starting another demo.",
  "Today's demo limit has been reached. Please try again tomorrow.",
  "You've reached the demo limit. Please try again later.",
  "The demo is busy. Please try again in a minute.",
]);
const TOKEN_MESSAGES = new Set([
  "Start a new demo session.",
  "The demo ended before connecting. Please try again.",
]);
const NETWORK_MESSAGES = new Set([
  "Open the demo on the VoiceInput website.",
  "The voice demo is temporarily unavailable.",
  "Unable to verify this demo request.",
  "Transcription took too long. Please try again.",
  "The transcription connection stopped. Please try again.",
  "Unable to connect. Please try again.",
  "This demo session is not ready or has reached its limit.",
  "Unsupported demo message.",
  "Invalid audio frame.",
  "The connection is too slow. Please try again.",
  "Transcription is unavailable right now. Please try again later.",
  "The voice demo is unavailable right now. Please try again later.",
  "The demo received an unexpected response. Please try again.",
  "The connection closed. Please try again.",
]);

export function getDemoErrorMessage(error: VoiceInputError): string {
  const message =
    curatedDemoMessage(error.code, error.message) ?? fallbackDemoMessage(error);
  return withRetryDelay(message, validRetryAfterMs(error.retryAfterMs));
}

export function liveDemo(onServerStop: () => void): VoiceInputProviderV1 {
  const provider: VoiceInputProviderV1 = {
    specificationVersion: "v1",
    provider: "voiceinput-demo",
    modelId: "gpt-transcribe",
    sampleRate: DEMO_SAMPLE_RATE,
    validateOptions(options) {
      if (
        options.language !== undefined ||
        options.vocabulary !== undefined ||
        options.endpointing !== undefined
      ) {
        throw new VoiceInputError({
          code: "unsupported-feature",
          message: "The public demo uses fixed transcription settings.",
        });
      }
    },
    async doOpen({ abortSignal }) {
      const response = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
        signal: abortSignal,
      });
      if (!response.ok) {
        const code = response.status === 429 ? "rate-limited" : "network-error";
        let serverMessage: unknown;
        try {
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body &&
            "error" in body &&
            typeof body.error === "string" &&
            body.error.length <= 500
          )
            serverMessage = body.error;
        } catch {
          /* Proxies may return a non-JSON error page. */
        }
        const seconds = Number(response.headers.get("Retry-After"));
        const retryAfterMs =
          Number.isFinite(seconds) && seconds > 0
            ? validRetryAfterMs(seconds * 1000)
            : undefined;
        throw new VoiceInputError({
          code,
          message:
            curatedDemoMessage(code, serverMessage) ??
            fallbackDemoMessage(code),
          retryable: true,
          retryAfterMs,
        });
      }
      const data: unknown = await response.json();
      if (
        typeof data !== "object" ||
        !data ||
        !("ticket" in data) ||
        typeof data.ticket !== "string" ||
        !/^[0-9a-f-]{36}$/.test(data.ticket)
      ) {
        throw new VoiceInputError({
          code: "token-error",
          message: "Unable to start the voice demo.",
        });
      }
      if (abortSignal.aborted) throw abortSignal.reason;
      const url = new URL("/api/demo/stream", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url, [
        DEMO_PROTOCOL,
        `ticket.${data.ticket}`,
      ]);
      let controller!: ReadableStreamDefaultController<VoiceInputProviderV1StreamPart>;
      const stream = new ReadableStream<VoiceInputProviderV1StreamPart>({
        start(value) {
          controller = value;
        },
      });
      let closed = false;
      let ready = false;
      let finishing = false;
      let resolveReady: () => void = () => {};
      let rejectReady: (reason: unknown) => void = () => {};
      const opened = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        abortSignal.removeEventListener("abort", abort);
        controller.close();
        socket.close();
      };
      const fail = (
        message: string,
        code:
          "network-error" | "rate-limited" | "token-error" = "network-error",
        retryAfterMs?: number,
      ) => {
        if (closed) return;
        retryAfterMs = validRetryAfterMs(retryAfterMs);
        const error = new VoiceInputError({
          code,
          message:
            curatedDemoMessage(code, message) ?? fallbackDemoMessage(code),
          retryAfterMs,
          retryable: true,
        });
        if (!ready) rejectReady(error);
        else controller.enqueue({ type: "error", error });
        close();
      };
      const abort = () => {
        if (!ready) rejectReady(abortSignal.reason);
        close();
      };
      const timeout = setTimeout(
        () => fail("Unable to connect. Please try again."),
        15_000,
      );
      socket.addEventListener("message", (event) => {
        if (closed) return;
        try {
          if (typeof event.data !== "string" || event.data.length > 64 * 1024)
            throw new Error("Invalid message");
          const part = JSON.parse(event.data) as Record<string, unknown>;
          if (part.type === "ready") {
            ready = true;
            clearTimeout(timeout);
            resolveReady();
          } else if (part.type === "stopping") {
            finishing = true;
            onServerStop();
          } else if (part.type === "finished") {
            if (!ready)
              fail(
                "The demo ended before connecting. Please try again.",
                "token-error",
              );
            else close();
          } else if (part.type === "error") {
            fail(
              typeof part.message === "string"
                ? part.message
                : "Transcription stopped. Please try again.",
              part.code === "rate-limited" || part.code === "token-error"
                ? part.code
                : "network-error",
              typeof part.retryAfterMs === "number"
                ? validRetryAfterMs(part.retryAfterMs)
                : undefined,
            );
          } else if (
            (part.type === "interim" || part.type === "final") &&
            typeof part.text === "string" &&
            (part.segmentId === undefined || typeof part.segmentId === "string")
          ) {
            controller.enqueue({
              type: part.type,
              text: part.text,
              ...(part.segmentId === undefined
                ? {}
                : { segmentId: part.segmentId }),
            });
          } else if (
            part.type === "speech-start" ||
            part.type === "speech-end"
          ) {
            controller.enqueue({ type: part.type });
          } else throw new Error("Invalid message");
        } catch {
          fail("The demo received an unexpected response. Please try again.");
        }
      });
      socket.addEventListener("close", () => {
        if (!closed) fail("The connection closed. Please try again.");
      });
      socket.addEventListener("error", () =>
        fail("Unable to connect. Please try again."),
      );
      abortSignal.addEventListener("abort", abort, { once: true });
      if (abortSignal.aborted) abort();
      await opened;
      return {
        stream,
        sendAudio(chunk) {
          if (closed || finishing || chunk.length === 0) return;
          return sendWithBackpressure(
            socket,
            chunk.byteLength,
            abortSignal,
            "voiceinput-demo",
            () => {
              if (!closed && !finishing) socket.send(chunk.slice().buffer);
            },
          );
        },
        finish() {
          if (closed || finishing) return;
          finishing = true;
          socket.send('{"type":"finish"}');
        },
        abort: close,
      };
    },
  };
  return {
    ...provider,
    async doOpen(options) {
      try {
        return await provider.doOpen(options);
      } catch (error) {
        // Retry only startup, before any audio can be sent. Never loop on quotas.
        if (
          options.abortSignal.aborted ||
          !(error instanceof VoiceInputError) ||
          !error.retryable ||
          (error.code !== "token-error" && error.code !== "network-error")
        )
          throw error;
        return provider.doOpen(options);
      }
    },
  };
}

function curatedDemoMessage(
  code: VoiceInputError["code"],
  message: unknown,
): string | undefined {
  if (typeof message !== "string") return undefined;
  const messages =
    code === "rate-limited"
      ? RATE_LIMIT_MESSAGES
      : code === "token-error"
        ? TOKEN_MESSAGES
        : code === "network-error"
          ? NETWORK_MESSAGES
          : undefined;
  return messages?.has(message) ? message : undefined;
}

function fallbackDemoMessage(
  error: VoiceInputError | VoiceInputError["code"],
): string {
  const code = typeof error === "string" ? error : error.code;
  if (code === "rate-limited") return "The demo limit has been reached.";
  if (code === "network-error")
    return "The voice demo is unavailable right now. Please try again later.";
  if (code === "token-error") return "Unable to start the voice demo.";
  return typeof error === "string"
    ? "Voice input failed. Try again."
    : getVoiceInputErrorMessage(error);
}

function validRetryAfterMs(value: number | undefined): number | undefined {
  return value !== undefined &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_DEMO_RETRY_AFTER_MS
    ? value
    : undefined;
}

function withRetryDelay(message: string, retryAfterMs?: number): string {
  if (!retryAfterMs) return message;
  const seconds = Math.ceil(retryAfterMs / 1000);
  if (
    message === "The demo is busy. Please try again in a minute." &&
    seconds <= 60
  )
    return message;
  const delay =
    seconds < 60
      ? `${seconds} ${seconds === 1 ? "second" : "seconds"}`
      : `${Math.ceil(seconds / 60)} ${seconds <= 60 ? "minute" : "minutes"}`;
  return `${message} You can retry in ${delay}.`;
}
