import type {
  VoiceAudioSource,
  VoiceInputError,
  VoiceInputTextLimit,
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

interface UseVoiceInputCommonOptions {
  provider?: VoiceInputProviderV1;
  audioSource?: VoiceAudioSource;
  language?: string;
  vocabulary?: readonly string[];
  endpointing?: false | VoiceEndpointingOptions;
  maxDurationMs?: number;
  connectionTimeoutMs?: number;
  interimBehavior?: VoiceInputInterimBehavior;
  transformTranscript?: VoiceInputTransformTranscript;
  transformTimeoutMs?: number;
  activationMode?: VoiceInputActivationMode;
  disabled?: boolean;
  onTextLimit?: (event: VoiceInputTextLimit) => void;
  onEvent?: (event: VoiceInputSessionEvent) => void;
  onStatusChange?: (
    status: VoiceInputStatus,
    previousStatus: VoiceInputStatus,
  ) => void;
  onInterimTranscript?: (text: string) => void;
  onFinalTranscriptPart?: (text: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onTranscriptChange?: (transcript: string) => void;
  onDurationWarning?: (remainingMs: number, maxDurationMs: number) => void;
  onStop?: (reason: VoiceInputStopReason) => void;
  onError?: (error: VoiceInputError) => void;
}

export type UseVoiceInputOptions = UseVoiceInputCommonOptions &
  (
    | {
        readonly value: string;
        readonly onValueChange: (value: string) => void;
      }
    | {
        readonly value?: never;
        readonly onValueChange?: never;
      }
  );

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
  /** Prefer getTriggerProps when adding application event handlers. */
  readonly triggerProps: VoiceInputTriggerProps;
  readonly isSupported: boolean;
  getTriggerProps(
    this: void,
    props?: ButtonHTMLAttributes<HTMLButtonElement>,
  ): ButtonHTMLAttributes<HTMLButtonElement> & VoiceInputTriggerProps;
  getTextSnapshot(this: void): VoiceInputTextEngineSnapshot;
  start(this: void): Promise<void>;
  stop(this: void, reason?: VoiceInputStopReason): Promise<void>;
  cancel(this: void): Promise<void>;
  undo(this: void): void;
  redo(this: void): void;
  toggle(this: void): Promise<void>;
}
