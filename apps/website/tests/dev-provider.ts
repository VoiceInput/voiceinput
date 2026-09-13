// Only loaded by the integration test's temporary Wrangler config.
// Production imports the real adapter and has no runtime mock switch.
import type {
  VoiceInputProviderV1,
  VoiceInputProviderV1StreamPart,
} from "@voiceinput/provider";

export function openai(): VoiceInputProviderV1 {
  return {
    specificationVersion: "v1",
    provider: "development-test",
    modelId: "fixture",
    sampleRate: 24_000,
    validateOptions() {},
    async doOpen() {
      let controller!: ReadableStreamDefaultController<VoiceInputProviderV1StreamPart>;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      return {
        stream: new ReadableStream({
          start(value) {
            controller = value;
          },
        }),
        sendAudio() {
          controller.enqueue({
            type: "final",
            text: "Local demo transport works.",
            segmentId: "fixture",
          });
        },
        finish: close,
        abort: close,
      };
    },
  };
}
