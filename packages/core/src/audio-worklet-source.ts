export const VOICE_INPUT_PROCESSOR_NAME = "voiceinput-pcm16";

interface ProcessorOptions {
  readonly processorOptions?: {
    readonly frameSamples?: number;
    readonly targetSampleRate?: number;
  };
}

interface WorkletMessageEvent {
  readonly data: unknown;
}

interface WorkletPort {
  onmessage: ((event: WorkletMessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
}

interface WorkletProcessorInstance {
  readonly port: WorkletPort;
}

export type VoiceInputWorkletProcessor = WorkletProcessorInstance & {
  process(inputs: readonly (readonly Float32Array[])[]): boolean;
};

type WorkletProcessorBase = new () => WorkletProcessorInstance;
type WorkletProcessorConstructor = new (
  options: ProcessorOptions,
) => VoiceInputWorkletProcessor;

/** Self-contained so the emitted function can also be loaded as a worklet. */
export function registerVoiceInputPcm16Processor(
  ProcessorBase: WorkletProcessorBase,
  sourceSampleRate: number,
  register: (name: string, processor: WorkletProcessorConstructor) => void,
  processorName: string,
): void {
  class VoiceInputPcm16Processor
    extends ProcessorBase
    implements VoiceInputWorkletProcessor
  {
    readonly #frameSamples: number;
    readonly #ratio: number;
    readonly #input: number[] = [];
    readonly #filter: readonly number[];
    readonly #filterHistory: Float32Array;

    #position = 0;
    #frame: Int16Array;
    #frameOffset = 0;
    #filterIndex = 0;

    constructor(options: ProcessorOptions) {
      super();
      const processorOptions = options.processorOptions ?? {};
      const targetSampleRate = processorOptions.targetSampleRate ?? 16_000;
      this.#frameSamples = processorOptions.frameSamples ?? 320;
      this.#ratio = sourceSampleRate / targetSampleRate;
      this.#filter = this.#createLowPassFilter();
      this.#filterHistory = new Float32Array(this.#filter.length);
      this.#frame = new Int16Array(this.#frameSamples);
      this.port.onmessage = (event) => {
        if (
          typeof event.data === "object" &&
          event.data !== null &&
          "type" in event.data &&
          event.data.type === "flush"
        ) {
          this.#flush();
          this.port.postMessage({ type: "flushed" });
        }
      };
    }

    process(inputs: readonly (readonly Float32Array[])[]): boolean {
      const channels = inputs[0];
      const sampleCount = channels?.[0]?.length ?? 0;
      if (
        channels === undefined ||
        channels.length === 0 ||
        sampleCount === 0
      ) {
        return true;
      }
      for (let index = 0; index < sampleCount; index += 1) {
        let monoSample = 0;
        for (const channel of channels) {
          monoSample += channel[index] ?? 0;
        }
        this.#input.push(this.#filterSample(monoSample / channels.length));
      }
      this.#drain();
      return true;
    }

    #createLowPassFilter(): readonly number[] {
      if (this.#ratio <= 1) {
        return [1];
      }
      const tapCount = 31;
      const center = (tapCount - 1) / 2;
      const cutoff = 0.45 / this.#ratio;
      const coefficients: number[] = [];
      let sum = 0;

      for (let index = 0; index < tapCount; index += 1) {
        const offset = index - center;
        const sinc =
          offset === 0
            ? 2 * cutoff
            : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
        const window =
          0.42 -
          0.5 * Math.cos((2 * Math.PI * index) / (tapCount - 1)) +
          0.08 * Math.cos((4 * Math.PI * index) / (tapCount - 1));
        const coefficient = sinc * window;
        coefficients.push(coefficient);
        sum += coefficient;
      }
      return coefficients.map((coefficient) => coefficient / sum);
    }

    #filterSample(sample: number): number {
      this.#filterHistory[this.#filterIndex] = sample;
      let filtered = 0;
      for (let tap = 0; tap < this.#filter.length; tap += 1) {
        const historyIndex =
          (this.#filterIndex - tap + this.#filter.length) % this.#filter.length;
        filtered +=
          (this.#filter[tap] ?? 0) * (this.#filterHistory[historyIndex] ?? 0);
      }
      this.#filterIndex = (this.#filterIndex + 1) % this.#filter.length;
      return filtered;
    }

    #drain(): void {
      while (this.#position + 1 < this.#input.length) {
        const lower = Math.floor(this.#position);
        const fraction = this.#position - lower;
        const first = this.#input[lower] ?? 0;
        const second = this.#input[lower + 1] ?? first;
        const sample = first + (second - first) * fraction;
        const clamped = Math.max(-1, Math.min(1, sample));
        this.#frame[this.#frameOffset] =
          clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        this.#frameOffset += 1;

        if (this.#frameOffset === this.#frame.length) {
          this.#emitFrame(this.#frame);
          this.#frame = new Int16Array(this.#frameSamples);
          this.#frameOffset = 0;
        }
        this.#position += this.#ratio;
      }

      // Retain the last source sample so interpolation and phase continue
      // correctly across AudioWorklet render quanta.
      const consumed = Math.min(
        Math.floor(this.#position),
        Math.max(0, this.#input.length - 1),
      );
      if (consumed > 0) {
        this.#input.splice(0, consumed);
        this.#position -= consumed;
      }
    }

    #flush(): void {
      const lastSample = this.#input.at(-1);
      if (lastSample !== undefined) {
        this.#input.push(lastSample);
        this.#drain();
      }
      if (this.#frameOffset > 0) {
        this.#emitFrame(this.#frame.slice(0, this.#frameOffset));
      }
      this.#input.length = 0;
      this.#position = 0;
      this.#frame = new Int16Array(this.#frameSamples);
      this.#frameOffset = 0;
    }

    #emitFrame(frame: Int16Array): void {
      const buffer = frame.buffer as ArrayBuffer;
      this.port.postMessage(buffer, [buffer]);
    }
  }

  register(processorName, VoiceInputPcm16Processor);
}

export const AUDIO_WORKLET_SOURCE = `(${registerVoiceInputPcm16Processor.toString()})(AudioWorkletProcessor, sampleRate, registerProcessor, ${JSON.stringify(
  VOICE_INPUT_PROCESSOR_NAME,
)});`;
