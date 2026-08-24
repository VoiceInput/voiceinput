import type {
  VoiceAudioSource,
  VoiceInputError,
  VoiceInputInterimBehavior,
  VoiceInputSessionEvent,
  VoiceInputSnapshot,
  VoiceInputStatus,
  VoiceInputStopReason,
  VoiceInputTextTarget,
  VoiceInputTextEngineSnapshot,
  VoiceInputTransformTranscript,
} from "@voiceinput/core";
import type {
  VoiceEndpointingOptions,
  VoiceInputProviderV1,
} from "@voiceinput/provider";
import type {
  ButtonHTMLAttributes,
  FocusEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  PointerEventHandler,
  RefCallback,
} from "react";

export type VoiceInputActivationMode = "toggle" | "hold";

export interface UseVoiceInputOptions {
  provider?: VoiceInputProviderV1;
  audioSource?: VoiceAudioSource;
  value?: string;
  onValueChange?: (value: string) => void;
  language?: string;
  vocabulary?: readonly string[];
  endpointing?: false | VoiceEndpointingOptions;
  maxDurationMs?: number;
  interimBehavior?: VoiceInputInterimBehavior;
  transformTranscript?: VoiceInputTransformTranscript;
  transformTimeoutMs?: number;
  activationMode?: VoiceInputActivationMode;
  disabled?: boolean;
  onEvent?: (event: VoiceInputSessionEvent) => void;
  onStatusChange?: (
    status: VoiceInputStatus,
    previousStatus: VoiceInputStatus,
  ) => void;
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onDurationWarning?: (remainingMs: number, maxDurationMs: number) => void;
  onStop?: (reason: VoiceInputStopReason) => void;
  onError?: (error: VoiceInputError) => void;
}

export interface VoiceInputTriggerProps extends Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed" | "disabled" | "type"
> {
  onBlur: FocusEventHandler<HTMLButtonElement>;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onKeyUp: KeyboardEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
}

export interface UseVoiceInputResult extends VoiceInputSnapshot {
  readonly targetRef: RefCallback<VoiceInputTextTarget>;
  readonly triggerProps: VoiceInputTriggerProps;
  readonly isSupported: boolean;
  getTextSnapshot(this: void): VoiceInputTextEngineSnapshot;
  start(this: void): Promise<void>;
  stop(this: void, reason?: VoiceInputStopReason): Promise<void>;
  cancel(this: void): Promise<void>;
  toggle(this: void): Promise<void>;
}
