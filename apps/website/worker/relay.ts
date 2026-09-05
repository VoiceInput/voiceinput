import type {
  VoiceInputProviderV1,
  VoiceInputProviderV1Session,
} from "@voiceinput/provider";
import { DEMO_SECONDS } from "../src/lib/demo-config";
import {
  CONNECT_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  MAX_AUDIO_BYTES,
  MAX_FRAME_BYTES,
  MAX_MESSAGES,
} from "./limits";

/** No audio or transcripts are logged or persisted. All limits are server-enforced. */
export async function relaySession(
  socket: WebSocket,
  provider: VoiceInputProviderV1,
): Promise<void> {
  const abort = new AbortController();
  let session: VoiceInputProviderV1Session | undefined;
  let closed = false;
  let finishing = false;
  let audioBytes = 0;
  let messages = 0;
  let queuedBytes = 0;
  let queue = Promise.resolve();
  let recordingTimer: ReturnType<typeof setTimeout> | null = null;
  let finalizingTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const send = (value: unknown) => {
    if (!closed && socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(value));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    clearTimeout(recordingTimer);
    clearTimeout(finalizingTimer);
    abort.abort();
    session?.abort();
    socket.close(1000, "Demo session ended");
    resolveDone();
  };
  const fail = (message: string) => {
    send({ type: "error", message });
    close();
  };
  const finish = () => {
    if (finishing || closed || !session) return;
    finishing = true;
    clearTimeout(recordingTimer);
    send({ type: "stopping" });
    finalizingTimer = setTimeout(
      () => fail("Transcription took too long. Please try again."),
      FINALIZE_TIMEOUT_MS,
    );
    queue = queue
      .then(async () => {
        if (!closed) await session?.finish();
      })
      .catch(() =>
        fail("The transcription connection stopped. Please try again."),
      );
  };
  const connectTimer = setTimeout(
    () => fail("Unable to connect. Please try again."),
    CONNECT_TIMEOUT_MS,
  );

  socket.addEventListener("close", close);
  socket.addEventListener("error", close);
  socket.addEventListener("message", (event) => {
    if (closed || finishing) return;
    if (++messages > MAX_MESSAGES || !session) {
      fail("This demo session is not ready or has reached its limit.");
      return;
    }
    if (typeof event.data === "string") {
      if (event.data === '{"type":"finish"}') finish();
      else fail("Unsupported demo message.");
      return;
    }
    if (
      !(event.data instanceof ArrayBuffer) ||
      event.data.byteLength % 2 !== 0 ||
      event.data.byteLength === 0 ||
      event.data.byteLength > MAX_FRAME_BYTES
    ) {
      fail("Invalid audio frame.");
      return;
    }
    const size = event.data.byteLength;
    if (audioBytes + size > MAX_AUDIO_BYTES) {
      finish();
      return;
    }
    if (queuedBytes + size > MAX_FRAME_BYTES * 4) {
      fail("The connection is too slow. Please try again.");
      return;
    }
    const chunk = new Int16Array(event.data);
    audioBytes += size;
    queuedBytes += size;
    queue = queue
      .then(async () => {
        try {
          if (!closed) await session?.sendAudio(chunk);
        } finally {
          queuedBytes -= size;
        }
      })
      .catch(() =>
        fail("The transcription connection stopped. Please try again."),
      );
    if (audioBytes === MAX_AUDIO_BYTES) finish();
  });

  try {
    session = await provider.doOpen({ abortSignal: abort.signal });
    if (closed) {
      session.abort();
      return;
    }
    clearTimeout(connectTimer);
    recordingTimer = setTimeout(finish, DEMO_SECONDS * 1_000);
    send({ type: "ready" });
    const pump = (async () => {
      try {
        for await (const part of session.stream) {
          if (closed) return;
          if (part.type === "error") {
            fail(
              "Transcription is unavailable right now. Please try again later.",
            );
            return;
          }
          send(part);
        }
        if (!closed) {
          if (finishing) {
            send({ type: "finished" });
            close();
          } else
            fail("The transcription connection stopped. Please try again.");
        }
      } catch {
        if (!closed)
          fail(
            "Transcription is unavailable right now. Please try again later.",
          );
      }
    })();
    await done;
    await pump;
  } catch {
    if (!closed)
      fail("The voice demo is unavailable right now. Please try again later.");
  } finally {
    close();
  }
}
