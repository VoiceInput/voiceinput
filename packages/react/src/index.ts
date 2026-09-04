"use client";

export { VoiceInputError } from "@voiceinput/core";
export type {
  VoiceInputSessionEvent,
  VoiceInputSnapshot,
  VoiceInputStatus,
  VoiceInputStopReason,
  VoiceInputTextLimit,
} from "@voiceinput/core";
export type {
  VoiceEndpointingOptions,
  VoiceInputProviderV1,
} from "@voiceinput/provider";
export { VoiceInputProvider, type VoiceInputProviderProps } from "./context.js";
export {
  VoiceButton,
  VoiceInput,
  VoiceTextarea,
  type VoiceButtonChildren,
  type VoiceButtonProps,
  type VoiceFieldButtonProps,
  type VoiceInputProps,
  type VoiceTextareaProps,
} from "./components.js";
export { useVoiceInput } from "./use-voice-input.js";
export type {
  UseVoiceInputOptions,
  UseVoiceInputResult,
  VoiceInputActivationMode,
  VoiceInputTriggerProps,
} from "./types.js";
