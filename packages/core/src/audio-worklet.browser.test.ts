import { describe, expect, it } from "vitest";

import {
  AUDIO_WORKLET_SOURCE,
  VOICE_INPUT_PROCESSOR_NAME,
} from "./audio-worklet-source.js";

describe("AudioWorklet browser protocol", () => {
  it("loads the generated module and acknowledges a graceful flush", async () => {
    const context = new AudioContext({ sampleRate: 16_000 });
    const url = URL.createObjectURL(
      new Blob([AUDIO_WORKLET_SOURCE], { type: "text/javascript" }),
    );

    try {
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context, VOICE_INPUT_PROCESSOR_NAME, {
        processorOptions: { frameSamples: 320, targetSampleRate: 16_000 },
      });
      const acknowledgement = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error("The AudioWorklet did not acknowledge flush.")),
          1_000,
        );
        node.port.onmessage = (event: MessageEvent<unknown>) => {
          if (
            typeof event.data === "object" &&
            event.data !== null &&
            "type" in event.data &&
            event.data.type === "flushed"
          ) {
            clearTimeout(timer);
            resolve(event.data);
          }
        };
      });

      node.port.postMessage({ type: "flush" });

      await expect(acknowledgement).resolves.toEqual({ type: "flushed" });
      node.port.close();
      node.disconnect();
    } finally {
      URL.revokeObjectURL(url);
      await context.close();
    }
  });
});
