import type { VoiceAudioSource } from "@voiceinput/core";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import type { VoiceInputProviderV1 } from "@voiceinput/provider";

/** This example deliberately generates text without accessing a microphone. */
export function createSimulation(): VoiceInputProviderV1 {
  const fake = createFakeVoiceInputProvider();
  return {
    ...fake.provider,
    async doOpen(options) {
      const session = await fake.provider.doOpen(options);
      const index = fake.controller.sessions.length - 1;
      const emitFinal = (): void =>
        fake.controller.emit(
          {
            type: "final",
            text: "Hello from VoiceInput.",
            segmentId: "greeting",
          },
          index,
        );
      const timers = [
        setTimeout(
          () =>
            fake.controller.emit(
              { type: "interim", text: "Hello", segmentId: "greeting" },
              index,
            ),
          150,
        ),
        setTimeout(
          () =>
            fake.controller.emit(
              { type: "interim", text: "Hello from", segmentId: "greeting" },
              index,
            ),
          350,
        ),
        setTimeout(emitFinal, 650),
      ];
      const clear = (): void => {
        for (const timer of timers) clearTimeout(timer);
      };
      options.abortSignal.addEventListener("abort", clear, { once: true });
      return {
        ...session,
        finish() {
          clear();
          emitFinal();
          options.abortSignal.removeEventListener("abort", clear);
          return session.finish();
        },
        abort(reason) {
          clear();
          options.abortSignal.removeEventListener("abort", clear);
          session.abort(reason);
        },
      };
    },
  };
}

export const simulatedAudio: VoiceAudioSource = {
  async prepare() {
    let controller!: ReadableStreamDefaultController<Int16Array>;
    const stream = new ReadableStream<Int16Array>({
      start(value) {
        controller = value;
      },
    });
    let closed = false;
    const close = (): void => {
      if (!closed) {
        closed = true;
        controller.close();
      }
    };
    return { stream, start() {}, stop: close, abort: close };
  },
};
