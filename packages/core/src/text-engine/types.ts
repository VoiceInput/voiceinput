import type { VoiceInputError } from "@voiceinput/provider";

export type VoiceInputTextTarget = HTMLInputElement | HTMLTextAreaElement;
export type VoiceInputInterimBehavior = "inline" | "expose";
export type VoiceInputTextSpanState =
  "provisional" | "finalized" | "frozen" | "transformed";

export interface VoiceInputTextSelection {
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
}

export interface VoiceInputTextSpan {
  readonly id: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly state: VoiceInputTextSpanState;
}

export interface VoiceInputTextEngineSnapshot {
  readonly value: string;
  readonly selection: VoiceInputTextSelection | null;
  readonly interimTranscript: string;
  readonly spans: readonly VoiceInputTextSpan[];
}

/**
 * Connects the engine's immediate shadow value to controlled application state.
 *
 * `getValue` supplies the value when a target is attached. `onValueChange`
 * requests an application update but is not expected to commit synchronously.
 * Pass each value committed by the application to
 * `reconcileControlledValue` on the text engine.
 */
export interface VoiceInputControlledTextBinding {
  getValue(): string;
  onValueChange(value: string): void;
  /** Notify through a native input event instead of the binding callback. */
  dispatchInput?: boolean;
}

export type VoiceInputTransformTranscript = (
  text: string,
) => PromiseLike<string> | string;

export interface VoiceInputTextLimit {
  readonly type: "text-limit";
  readonly maxLength: number;
  readonly text: string;
  readonly insertedText: string;
  readonly source: "interim" | "final" | "transform";
}

export type VoiceInputTextEngineEvent =
  VoiceInputTextLimit | { type: "target-unavailable" | "reset" };

export interface CreateVoiceInputTextEngineOptions {
  interimBehavior?: VoiceInputInterimBehavior;
  controlled?: VoiceInputControlledTextBinding;
  transformTranscript?: VoiceInputTransformTranscript;
  transformTimeoutMs?: number;
}

export interface VoiceInputTextCompletion {
  readonly processing: boolean;
  readonly result: Promise<readonly VoiceInputError[]>;
}

export interface VoiceInputTextEngine {
  getSnapshot(): VoiceInputTextEngineSnapshot;
  setTarget(target: VoiceInputTextTarget | null): void;
  captureSelection(): VoiceInputTextSelection | null;
  reconcileControlledValue(value: string): void;
  updateOptions(
    options: Omit<CreateVoiceInputTextEngineOptions, "controlled">,
  ): void;
  begin(): void;
  applyInterim(text: string, segmentId?: string): void;
  applyFinal(text: string, segmentId?: string): void;
  complete(): VoiceInputTextCompletion;
  cancel(): void;
  undo(): void;
  redo(): void;
  isWritable(): boolean;
  subscribe(listener: (event: VoiceInputTextEngineEvent) => void): () => void;
  destroy(): void;
}
