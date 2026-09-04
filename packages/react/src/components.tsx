import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode,
  type RefCallback,
  type TextareaHTMLAttributes,
} from "react";

import type { UseVoiceInputOptions, UseVoiceInputResult } from "./types.js";
import { useVoiceInput, useVoiceInputInternal } from "./use-voice-input.js";

export type VoiceButtonChildren =
  ReactNode | ((voice: UseVoiceInputResult) => ReactNode);

export interface VoiceButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Options passed directly to the underlying useVoiceInput call. */
  readonly voice?: UseVoiceInputOptions;
  readonly children?: VoiceButtonChildren;
  /** Set false when the application provides its own live region. */
  readonly announce?: boolean;
  readonly getAnnouncement?: (voice: UseVoiceInputResult) => string;
}

export interface VoiceFieldButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  readonly children?: VoiceButtonChildren;
  readonly announce?: boolean;
  readonly getAnnouncement?: (voice: UseVoiceInputResult) => string;
}

interface SharedVoiceFieldOptions {
  /** Options passed directly to the underlying useVoiceInput call. */
  readonly voice?: Omit<UseVoiceInputOptions, "value" | "onValueChange">;
  readonly containerClassName?: string;
  readonly voiceButtonProps?: VoiceFieldButtonProps;
}

type VoiceFieldBinding =
  | {
      readonly value: string;
      readonly onValueChange: (value: string) => void;
    }
  | {
      readonly value?: never;
      readonly onValueChange?: never;
    };

export type VoiceInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "type" | "value"
> &
  SharedVoiceFieldOptions &
  VoiceFieldBinding & {
    readonly type?: "search" | "tel" | "text" | "url";
  };

export type VoiceTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "children" | "value"
> &
  SharedVoiceFieldOptions &
  VoiceFieldBinding;

const visuallyHiddenStyle: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

export const VoiceButton = /* @__PURE__ */ forwardRef<
  HTMLButtonElement,
  VoiceButtonProps
>(function VoiceButton({ voice: options, ...props }, forwardedRef) {
  const voice = useVoiceInput({
    ...options,
    disabled: props.disabled === true || options?.disabled === true,
  });
  return <VoiceButtonElement {...props} ref={forwardedRef} voice={voice} />;
});

export const VoiceInput = /* @__PURE__ */ forwardRef<
  HTMLInputElement,
  VoiceInputProps
>(function VoiceInput(
  {
    className,
    containerClassName,
    disabled,
    readOnly,
    onChange,
    onValueChange,
    type = "text",
    value,
    voice: options,
    voiceButtonProps,
    ...props
  },
  forwardedRef,
) {
  const voice = useVoiceField({
    disabled:
      disabled === true ||
      readOnly === true ||
      voiceButtonProps?.disabled === true,
    onValueChange,
    options,
    value,
  });
  const targetRef = useComposedTargetRef(voice, forwardedRef);
  return (
    <span
      className={joinClassNames("voiceinput-field", containerClassName)}
      {...voiceDataAttributes(voice)}
    >
      <input
        {...props}
        ref={targetRef}
        className={joinClassNames("voiceinput-field__input", className)}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => {
          onValueChange?.(event.currentTarget.value);
          onChange?.(event);
        }}
        type={type}
        value={value}
      />
      <VoiceButtonElement
        {...voiceButtonProps}
        className={joinClassNames(
          "voiceinput-field__button",
          voiceButtonProps?.className,
        )}
        voice={voice}
      />
    </span>
  );
});

export const VoiceTextarea = /* @__PURE__ */ forwardRef<
  HTMLTextAreaElement,
  VoiceTextareaProps
>(function VoiceTextarea(
  {
    className,
    containerClassName,
    disabled,
    readOnly,
    onChange,
    onValueChange,
    value,
    voice: options,
    voiceButtonProps,
    ...props
  },
  forwardedRef,
) {
  const voice = useVoiceField({
    disabled:
      disabled === true ||
      readOnly === true ||
      voiceButtonProps?.disabled === true,
    onValueChange,
    options,
    value,
  });
  const targetRef = useComposedTargetRef(voice, forwardedRef);
  return (
    <span
      className={joinClassNames(
        "voiceinput-field voiceinput-field--textarea",
        containerClassName,
      )}
      {...voiceDataAttributes(voice)}
    >
      <textarea
        {...props}
        ref={targetRef}
        className={joinClassNames("voiceinput-field__input", className)}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => {
          onValueChange?.(event.currentTarget.value);
          onChange?.(event);
        }}
        value={value}
      />
      <VoiceButtonElement
        {...voiceButtonProps}
        className={joinClassNames(
          "voiceinput-field__button",
          voiceButtonProps?.className,
        )}
        voice={voice}
      />
    </span>
  );
});

interface VoiceButtonElementProps extends VoiceFieldButtonProps {
  readonly voice: UseVoiceInputResult;
}

const VoiceButtonElement = /* @__PURE__ */ forwardRef<
  HTMLButtonElement,
  VoiceButtonElementProps
>(function VoiceButtonElement(
  {
    announce = true,
    children,
    className,
    disabled,
    getAnnouncement = defaultAnnouncement,
    onBlur,
    onClick,
    onKeyDown,
    onKeyUp,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerUp,
    type,
    voice,
    ...props
  },
  forwardedRef,
) {
  const announcementId = useId();
  const active = isActive(voice);
  const label = defaultButtonLabel(voice);
  const describedBy = [props["aria-describedby"], announce && announcementId]
    .filter(Boolean)
    .join(" ");
  const trigger = voice.triggerProps;

  return (
    <>
      <button
        {...props}
        {...voiceDataAttributes(voice)}
        ref={forwardedRef}
        aria-describedby={describedBy || undefined}
        aria-label={props["aria-label"] ?? label}
        aria-pressed={trigger["aria-pressed"]}
        className={joinClassNames("voiceinput-button", className)}
        disabled={disabled === true || trigger.disabled}
        type={type ?? trigger.type}
        onBlur={composeEventHandlers(onBlur, trigger.onBlur)}
        onClick={composeEventHandlers(onClick, trigger.onClick)}
        onKeyDown={composeEventHandlers(onKeyDown, trigger.onKeyDown)}
        onKeyUp={composeEventHandlers(onKeyUp, trigger.onKeyUp)}
        onLostPointerCapture={composeEventHandlers(
          onLostPointerCapture,
          trigger.onLostPointerCapture,
        )}
        onPointerCancel={composeEventHandlers(
          onPointerCancel,
          trigger.onPointerCancel,
        )}
        onPointerDown={composeEventHandlers(
          onPointerDown,
          trigger.onPointerDown,
        )}
        onPointerUp={composeEventHandlers(onPointerUp, trigger.onPointerUp)}
      >
        {typeof children === "function"
          ? children(voice)
          : (children ?? (
              <DefaultButtonContent active={active} label={label} />
            ))}
      </button>
      {announce ? (
        <span
          id={announcementId}
          aria-live={voice.error === null ? "polite" : "assertive"}
          className="voiceinput-sr-only"
          role={voice.error === null ? "status" : "alert"}
          style={visuallyHiddenStyle}
        >
          {getAnnouncement(voice)}
        </span>
      ) : null}
    </>
  );
});

function DefaultButtonContent({
  active,
  label,
}: {
  readonly active: boolean;
  readonly label: string;
}): ReactNode {
  return (
    <>
      <span aria-hidden="true" className="voiceinput-button__icon">
        {active ? <StopIcon /> : <MicrophoneIcon />}
      </span>
      <span className="voiceinput-button__label">{label}</span>
    </>
  );
}

function MicrophoneIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"
        fill="currentColor"
      />
      <path
        d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4m-3 0h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function useVoiceField(options: {
  readonly disabled: boolean | undefined;
  readonly onValueChange: ((value: string) => void) | undefined;
  readonly options:
    Omit<UseVoiceInputOptions, "value" | "onValueChange"> | undefined;
  readonly value: string | undefined;
}): UseVoiceInputResult {
  const controlled =
    options.value !== undefined || options.onValueChange !== undefined;
  return useVoiceInputInternal(
    {
      ...options.options,
      disabled: options.disabled === true || options.options?.disabled === true,
      ...(controlled && options.value !== undefined
        ? { value: options.value }
        : {}),
      ...(controlled && options.onValueChange !== undefined
        ? { onValueChange: options.onValueChange }
        : {}),
    },
    true,
  );
}

function useComposedTargetRef<T extends HTMLInputElement | HTMLTextAreaElement>(
  voice: UseVoiceInputResult,
  forwardedRef: ForwardedRef<T>,
): RefCallback<T> {
  const { targetRef } = voice;
  const nodeRef = useRef<T | null>(null);

  useImperativeHandle(forwardedRef, () => nodeRef.current as T, []);

  return useCallback(
    (node: T | null) => {
      nodeRef.current = node;
      targetRef(node);
    },
    [targetRef],
  );
}

function voiceDataAttributes(
  voice: UseVoiceInputResult,
): Record<string, string> {
  return {
    "data-voiceinput-active": String(isActive(voice)),
    "data-voiceinput-error": voice.error?.code ?? "",
    "data-voiceinput-status": voice.status,
    "data-voiceinput-supported": String(voice.isSupported),
  };
}

function isActive(voice: UseVoiceInputResult): boolean {
  return voice.status !== "error" && voice.status !== "idle";
}

function defaultButtonLabel(voice: UseVoiceInputResult): string {
  if (!voice.isSupported) {
    return "Voice input unavailable";
  }
  switch (voice.status) {
    case "requesting-permission":
      return "Requesting access";
    case "connecting":
      return "Connecting";
    case "listening":
      return "Stop voice input";
    case "stopping":
      return "Finishing";
    case "processing":
      return "Processing";
    case "error":
    case "idle":
      return "Start voice input";
  }
}

function defaultAnnouncement(voice: UseVoiceInputResult): string {
  if (!voice.isSupported) {
    return "Voice input is unavailable in this browser.";
  }
  if (voice.error !== null) {
    return `Voice input error: ${voice.error.message}`;
  }
  switch (voice.status) {
    case "idle":
      return "Voice input ready.";
    case "requesting-permission":
      return "Requesting microphone permission.";
    case "connecting":
      return "Connecting voice input.";
    case "listening":
      return "Voice input is listening.";
    case "stopping":
      return "Finishing voice input.";
    case "processing":
      return "Processing the transcript.";
    case "error":
      return "Voice input stopped with an error.";
  }
}

type SupportedEvent = {
  readonly defaultPrevented: boolean;
};

function composeEventHandlers<E extends SupportedEvent>(
  consumer: ((event: E) => void) | undefined,
  internal: (event: E) => void,
): (event: E) => void {
  return (event) => {
    consumer?.(event);
    if (!event.defaultPrevented) {
      internal(event);
    }
  };
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
