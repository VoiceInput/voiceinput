import type {
  UseVoiceInputOptions,
  VoiceInputProps,
  VoiceTextareaProps,
} from "./index.js";

const setValue = (_value: string): void => {};

({ value: "hello", onValueChange: setValue }) satisfies UseVoiceInputOptions;
({}) satisfies UseVoiceInputOptions;
({ value: "hello", onValueChange: setValue }) satisfies VoiceInputProps;
({}) satisfies VoiceTextareaProps;

// @ts-expect-error Controlled hooks require onValueChange.
({ value: "hello" }) satisfies UseVoiceInputOptions;
// @ts-expect-error Controlled hooks require value.
({ onValueChange: setValue }) satisfies UseVoiceInputOptions;
// @ts-expect-error Controlled fields require onValueChange.
({ value: "hello" }) satisfies VoiceInputProps;
// @ts-expect-error Controlled fields require value.
({ onValueChange: setValue }) satisfies VoiceTextareaProps;
