import { describe, expect, it } from "vitest";

import {
  AUDIO_WORKLET_SOURCE,
  VOICE_INPUT_PROCESSOR_NAME,
  registerVoiceInputPcm16Processor,
  type VoiceInputWorkletProcessor,
} from "./audio-worklet-source.js";

describe("PCM16 AudioWorklet processor", () => {
  it("keeps resampling phase continuous across render quanta", () => {
    const harness = createProcessor({
      sourceSampleRate: 48_000,
      targetSampleRate: 16_000,
      frameSamples: 320,
    });
    const inputSampleCount = 128_000;

    for (let offset = 0; offset < inputSampleCount; offset += 128) {
      const quantum = new Float32Array(128);
      for (let index = 0; index < quantum.length; index += 1) {
        quantum[index] = (offset + index) / inputSampleCount;
      }
      harness.processor.process([[quantum]]);
    }
    harness.flush();

    const output = harness.samples();
    expect(Math.abs(output.length - inputSampleCount / 3)).toBeLessThanOrEqual(
      1,
    );
    expect(output.at(-1)).toBeGreaterThan(32_000);
    for (let index = 1; index < output.length; index += 1) {
      expect(output[index]).toBeGreaterThanOrEqual(output[index - 1] ?? 0);
    }
  });

  it("flushes a partial frame before acknowledging shutdown", () => {
    const harness = createProcessor({
      sourceSampleRate: 48_000,
      targetSampleRate: 16_000,
      frameSamples: 320,
    });
    harness.processor.process([[new Float32Array(128).fill(0.5)]]);

    expect(harness.frames).toHaveLength(0);
    harness.flush();

    expect(harness.frames).toHaveLength(1);
    expect(harness.frames[0]?.length).toBeGreaterThan(0);
    expect(harness.messages.at(-1)).toEqual({ type: "flushed" });
  });

  it("filters frequencies above the target Nyquist limit", () => {
    const lowFrequency = renderTone(1_000);
    const aliasedFrequency = renderTone(12_000);

    expect(rootMeanSquare(aliasedFrequency)).toBeLessThan(
      rootMeanSquare(lowFrequency) * 0.1,
    );
  });

  it("downmixes every input channel instead of discarding channels", () => {
    const harness = createProcessor({
      sourceSampleRate: 16_000,
      targetSampleRate: 16_000,
      frameSamples: 64,
    });
    harness.processor.process([
      [new Float32Array(128).fill(1), new Float32Array(128).fill(-1)],
    ]);
    harness.flush();

    expect(
      Math.max(...harness.samples().map((sample) => Math.abs(sample))),
    ).toBe(0);
  });

  it("emits a self-contained module for the registered processor name", () => {
    let registeredName: string | undefined;
    // oxlint-disable-next-line typescript/no-implied-eval -- This parses the generated worklet exactly as the browser does.
    const initialize = new Function(
      "AudioWorkletProcessor",
      "sampleRate",
      "registerProcessor",
      AUDIO_WORKLET_SOURCE,
    ) as (
      base: new () => { port: TestPort },
      sampleRate: number,
      register: (name: string) => void,
    ) => void;

    initialize(TestProcessorBase, 48_000, (name) => {
      registeredName = name;
    });

    expect(registeredName).toBe(VOICE_INPUT_PROCESSOR_NAME);
  });
});

interface TestPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

function renderTone(frequency: number): number[] {
  const sourceSampleRate = 48_000;
  const harness = createProcessor({
    sourceSampleRate,
    targetSampleRate: 16_000,
    frameSamples: 320,
  });
  for (let offset = 0; offset < sourceSampleRate; offset += 128) {
    const quantum = new Float32Array(128);
    for (let index = 0; index < quantum.length; index += 1) {
      quantum[index] = Math.sin(
        (2 * Math.PI * frequency * (offset + index)) / sourceSampleRate,
      );
    }
    harness.processor.process([[quantum]]);
  }
  harness.flush();
  return harness.samples().slice(100);
}

function rootMeanSquare(samples: readonly number[]): number {
  return Math.sqrt(
    samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
  );
}

class TestProcessorBase {
  readonly port: TestPort = {
    onmessage: null,
    postMessage() {},
  };
}

function createProcessor(options: {
  sourceSampleRate: number;
  targetSampleRate: number;
  frameSamples: number;
}): {
  processor: VoiceInputWorkletProcessor;
  frames: Int16Array[];
  messages: unknown[];
  flush(): void;
  samples(): number[];
} {
  const frames: Int16Array[] = [];
  const messages: unknown[] = [];
  let Processor:
    | (new (options: {
        processorOptions: {
          targetSampleRate: number;
          frameSamples: number;
        };
      }) => VoiceInputWorkletProcessor)
    | undefined;

  class HarnessProcessorBase {
    readonly port: TestPort = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage(message: unknown): void {
        messages.push(message);
        if (message instanceof ArrayBuffer) {
          frames.push(new Int16Array(message));
        }
      },
    };
  }

  registerVoiceInputPcm16Processor(
    HarnessProcessorBase,
    options.sourceSampleRate,
    (_name, constructor) => {
      Processor = constructor;
    },
    VOICE_INPUT_PROCESSOR_NAME,
  );
  if (Processor === undefined) {
    throw new Error("The worklet processor was not registered.");
  }

  const processor = new Processor({
    processorOptions: {
      frameSamples: options.frameSamples,
      targetSampleRate: options.targetSampleRate,
    },
  });
  return {
    processor,
    frames,
    messages,
    flush() {
      processor.port.onmessage?.({ data: { type: "flush" } });
    },
    samples() {
      return frames.flatMap((frame) => [...frame]);
    },
  };
}
