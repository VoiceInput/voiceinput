import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1StreamPart,
} from "@voiceinput/provider";
import { sendWithBackpressure } from "@voiceinput/provider/transport";
import { DEMO_PROTOCOL, DEMO_SAMPLE_RATE } from "./demo-config";

export function liveDemo(onServerStop: () => void): VoiceInputProviderV1 {
  return {
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
        let message =
          response.status === 429
            ? "The demo limit has been reached."
            : "The voice demo is unavailable right now. Please try again later.";
        try {
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body &&
            "error" in body &&
            typeof body.error === "string" &&
            body.error.length <= 500
          )
            message = body.error;
        } catch {
          /* Proxies may return a non-JSON error page. */
        }
        const seconds = Number(response.headers.get("Retry-After"));
        const retryAfterMs =
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
        throw new VoiceInputError({
          code: response.status === 429 ? "rate-limited" : "network-error",
          message: withRetryDelay(message, retryAfterMs),
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
        const error = new VoiceInputError({
          code,
          message: withRetryDelay(message, retryAfterMs),
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
            close();
          } else if (part.type === "error") {
            fail(
              typeof part.message === "string"
                ? part.message
                : "Transcription stopped. Please try again.",
              part.code === "rate-limited" || part.code === "token-error"
                ? part.code
                : "network-error",
              typeof part.retryAfterMs === "number" &&
                Number.isFinite(part.retryAfterMs) &&
                part.retryAfterMs > 0
                ? part.retryAfterMs
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
}

function withRetryDelay(message: string, retryAfterMs?: number): string {
  if (!retryAfterMs) return message;
  const seconds = Math.ceil(retryAfterMs / 1000);
  const delay =
    seconds < 60
      ? `${seconds} ${seconds === 1 ? "second" : "seconds"}`
      : `${Math.ceil(seconds / 60)} ${seconds <= 60 ? "minute" : "minutes"}`;
  return `${message} You can retry in ${delay}.`;
}
