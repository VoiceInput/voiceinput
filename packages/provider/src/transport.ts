import { VoiceInputError } from "./index.js";

const MAX_BUFFERED_BYTES = 1024 * 1024;
const DRAIN_TIMEOUT_MS = 5_000;

/** Keeps nominal sends synchronous; congested sends are abortable and bounded. */
export function sendWithBackpressure(
  socket: { readonly bufferedAmount: number; readonly readyState: number },
  bytes: number,
  signal: AbortSignal,
  provider: string,
  send: () => void,
): Promise<void> | void {
  const failure = () =>
    new VoiceInputError({
      code: "network-error",
      provider,
      retryable: true,
      message: `The ${provider} audio connection is stalled or closed.`,
    });
  if (signal.aborted || socket.readyState !== 1 || bytes > MAX_BUFFERED_BYTES)
    throw failure();
  if ((socket.bufferedAmount ?? 0) + bytes <= MAX_BUFFERED_BYTES) return send();
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      cleanup();
      reject(failure());
    };
    const check = (): void => {
      if (
        signal.aborted ||
        socket.readyState !== 1 ||
        Date.now() - started >= DRAIN_TIMEOUT_MS
      ) {
        abort();
      } else if ((socket.bufferedAmount ?? 0) + bytes <= MAX_BUFFERED_BYTES) {
        cleanup();
        try {
          send();
          resolve();
        } catch (error) {
          reject(error);
        }
      } else timer = setTimeout(check, 25);
    };
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(check, 25);
  });
}
