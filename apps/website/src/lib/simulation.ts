import type { VoiceAudioSource } from "@voiceinput/core";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import type { VoiceInputProviderV1 } from "@voiceinput/provider";

export function createSimulation(): VoiceInputProviderV1 {
  const fake = createFakeVoiceInputProvider();
  return {
    ...fake.provider,
    async doOpen(options) {
      const session = await fake.provider.doOpen(options);
      const index = fake.controller.sessions.length - 1;
      const phrases = [
        "Let your ideas do the talking.",
        "Keep your cursor. Keep your flow.",
      ];
      const timers: ReturnType<typeof setTimeout>[] = [];
      let latest: { text: string; segmentId: string } | undefined;
      let finished = false;
      phrases.forEach((text, phraseIndex) => {
        const words = text.split(" ");
        words.forEach((_, i) => {
          timers.push(
            setTimeout(
              () => {
                latest = {
                  text: words.slice(0, i + 1).join(" "),
                  segmentId: `phrase-${phraseIndex}`,
                };
                fake.controller.emit(
                  {
                    type: i === words.length - 1 ? "final" : "interim",
                    ...latest,
                  },
                  index,
                );
                if (i === words.length - 1) latest = undefined;
              },
              600 + phraseIndex * 3000 + i * 350,
            ),
          );
        });
      });
      const clear = () => {
        timers.forEach(clearTimeout);
      };
      options.abortSignal.addEventListener("abort", clear, { once: true });
      return {
        ...session,
        finish() {
          clear();
          if (!finished && latest)
            fake.controller.emit({ type: "final", ...latest }, index);
          finished = true;
          options.abortSignal.removeEventListener("abort", clear);
          return session.finish();
        },
        abort(reason) {
          clear();
          finished = true;
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
    const close = () => {
      if (!closed) {
        closed = true;
        controller.close();
      }
    };
    return { stream, start() {}, stop: close, abort: close };
  },
};
