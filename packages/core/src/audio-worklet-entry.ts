import {
  registerVoiceInputPcm16Processor,
  VOICE_INPUT_PROCESSOR_NAME,
} from "./audio-worklet-source.js";

declare const AudioWorkletProcessor: Parameters<
  typeof registerVoiceInputPcm16Processor
>[0];
declare const sampleRate: number;
declare const registerProcessor: Parameters<
  typeof registerVoiceInputPcm16Processor
>[2];

registerVoiceInputPcm16Processor(
  AudioWorkletProcessor,
  sampleRate,
  registerProcessor,
  VOICE_INPUT_PROCESSOR_NAME,
);
