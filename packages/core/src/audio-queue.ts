import { VoiceInputError } from "@voiceinput/provider";

/** A bounded FIFO shared by startup buffering and a slow provider transport. */
export class AudioQueue {
  #chunks: Int16Array[] = [];
  #samples = 0;
  #closed = false;
  #wake: (() => void) | undefined;
  constructor(readonly maximumSamples: number) {}

  push(chunk: Int16Array): void {
    if (this.#closed) return;
    if (this.#samples + chunk.length > this.maximumSamples) {
      throw new VoiceInputError({
        code: "network-error",
        retryable: true,
        message:
          "Audio could not be sent fast enough. Recording stopped before the audio buffer overflowed.",
      });
    }
    this.#chunks.push(chunk.slice());
    this.#samples += chunk.length;
    this.#wake?.();
    this.#wake = undefined;
  }

  async read(): Promise<Int16Array | undefined> {
    while (!this.#closed && this.#chunks.length === 0) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    const chunk = this.#chunks.shift();
    if (chunk) this.#samples -= chunk.length;
    return chunk;
  }

  close(discard = false): void {
    this.#closed = true;
    if (discard) {
      this.#chunks = [];
      this.#samples = 0;
    }
    this.#wake?.();
    this.#wake = undefined;
  }
}
