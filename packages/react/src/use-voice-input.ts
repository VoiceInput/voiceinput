import {
  VoiceInputError,
  createBrowserAudioSource,
  createVoiceInputSession,
  createVoiceInputTextEngine,
  getBrowserVoiceInputSupport,
  type VoiceInputSessionEvent,
  type VoiceInputStatus,
  type VoiceInputStopReason,
  type VoiceInputTextTarget,
} from "@voiceinput/core";
import {
  type ButtonHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  type CoordinatedVoiceInputSession,
  VoiceInputCoordinator,
} from "./coordinator.js";
import { VoiceInputContext } from "./context.js";
import type {
  UseVoiceInputOptions,
  UseVoiceInputResult,
  VoiceInputTriggerProps,
} from "./types.js";

const ACTIVE_KEYS = new Set(["Enter", " "]);
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useVoiceInput(
  options: UseVoiceInputOptions = {},
): UseVoiceInputResult {
  return useVoiceInputInternal(options);
}

export function useVoiceInputInternal(
  options: UseVoiceInputOptions = {},
  dispatchInput = false,
): UseVoiceInputResult {
  const context = useContext(VoiceInputContext);
  const provider = options.provider ?? context?.provider;
  if (provider === undefined) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message:
        "useVoiceInput requires a provider option or a parent VoiceInputProvider.",
    });
  }

  const controlled =
    options.value !== undefined || options.onValueChange !== undefined;
  if (
    controlled &&
    (typeof options.value !== "string" ||
      typeof options.onValueChange !== "function")
  ) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message:
        "Controlled voice input requires both value and onValueChange options.",
    });
  }

  const initialControlled = useRef(controlled);
  if (initialControlled.current !== controlled) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message:
        "A voice field cannot switch between controlled and uncontrolled modes. Remount it with a new key.",
    });
  }
  const latest = useRef(options);
  latest.current = options;
  const disabled = options.disabled ?? false;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const disposedRef = useRef(false);
  const selectionCapturedRef = useRef(false);
  const heldPointerRef = useRef<number | null>(null);
  const heldKeyRef = useRef<string | null>(null);
  const targetNodeRef = useRef<VoiceInputTextTarget | null>(null);

  const browserAudioSource = useMemo(() => createBrowserAudioSource(), []);
  const audioSource =
    options.audioSource ?? context?.audioSource ?? browserAudioSource;
  const standaloneCoordinator = useMemo(() => new VoiceInputCoordinator(), []);
  const coordinator = context?.coordinator ?? standaloneCoordinator;

  const vocabularyKey = JSON.stringify(options.vocabulary ?? null);
  const vocabulary = useMemo(
    () =>
      options.vocabulary === undefined ? undefined : [...options.vocabulary],
    // The serialized key prevents inline string-array options from recreating a live session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vocabularyKey],
  );
  const endpointingKey = JSON.stringify(options.endpointing ?? null);
  const endpointing = useMemo(
    () =>
      typeof options.endpointing === "object"
        ? { ...options.endpointing }
        : options.endpointing,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpointingKey],
  );
  const hasTransform = options.transformTranscript !== undefined;

  const [textEngine] = useState(() => {
    const nextTextEngine = createVoiceInputTextEngine({
      ...(controlled
        ? {
            controlled: {
              getValue: () => latest.current.value ?? "",
              dispatchInput,
              onValueChange: (value: string) =>
                latest.current.onValueChange?.(value),
            },
          }
        : {}),
      ...(options.interimBehavior === undefined
        ? {}
        : { interimBehavior: options.interimBehavior }),
      ...(!hasTransform
        ? {}
        : {
            transformTranscript: (text: string) => {
              const transform = latest.current.transformTranscript;
              if (transform === undefined) {
                throw new TypeError("transformTranscript is unavailable.");
              }
              return transform(text);
            },
          }),
      ...(options.transformTimeoutMs === undefined
        ? {}
        : { transformTimeoutMs: options.transformTimeoutMs }),
    });
    return nextTextEngine;
  });
  const [session] = useState(() =>
    createVoiceInputSession({ provider, audioSource, textEngine }),
  );
  useIsomorphicLayoutEffect(() => {
    textEngine.updateOptions({
      ...(options.interimBehavior === undefined
        ? {}
        : { interimBehavior: options.interimBehavior }),
      ...(options.transformTranscript === undefined
        ? {}
        : { transformTranscript: options.transformTranscript }),
      ...(options.transformTimeoutMs === undefined
        ? {}
        : { transformTimeoutMs: options.transformTimeoutMs }),
    });
    session.updateOptions({
      provider,
      audioSource,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(vocabulary === undefined ? {} : { vocabulary }),
      ...(endpointing === undefined ? {} : { endpointing }),
      ...(options.maxDurationMs === undefined
        ? {}
        : { maxDurationMs: options.maxDurationMs }),
      ...(options.connectionTimeoutMs === undefined
        ? {}
        : { connectionTimeoutMs: options.connectionTimeoutMs }),
    });
  }, [
    session,
    provider,
    audioSource,
    textEngine,
    options.language,
    vocabulary,
    endpointing,
    options.maxDurationMs,
    options.connectionTimeoutMs,
    options.interimBehavior,
    options.transformTranscript,
    options.transformTimeoutMs,
  ]);
  const currentTextEngineRef = useRef(textEngine);
  currentTextEngineRef.current = textEngine;
  const undo = useCallback(() => textEngine.undo(), [textEngine]);
  const redo = useCallback(() => textEngine.redo(), [textEngine]);
  const getTextSnapshot = useCallback(
    () => textEngine.getSnapshot(),
    [textEngine],
  );

  useEffect(
    () => () => {
      queueMicrotask(() => {
        if (
          disposedRef.current ||
          currentTextEngineRef.current !== textEngine
        ) {
          textEngine.destroy();
        }
      });
    },
    [textEngine],
  );

  const coordinatedSession = useMemo<CoordinatedVoiceInputSession>(
    () => ({ stop: (reason) => session.stop(reason) }),
    [session],
  );

  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(() => listener()),
    [session],
  );
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(getBrowserVoiceInputSupport().isSupported);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (controlled) {
      textEngine.reconcileControlledValue(latest.current.value ?? "");
    }
  }, [controlled, options.value, textEngine]);

  useEffect(() => {
    return session.subscribe((event) => {
      dispatchCallback(latest.current, event);
      if (
        (event.type === "status-change" && event.status === "error") ||
        event.type === "stop" ||
        event.type === "cancel"
      ) {
        coordinator.release(coordinatedSession);
      }
    });
  }, [coordinatedSession, coordinator, session]);

  const captureSelection = useCallback(() => {
    selectionCapturedRef.current = textEngine.captureSelection() !== null;
  }, [textEngine]);

  const startInternal = useCallback(
    async (capture = true): Promise<void> => {
      if (
        disabledRef.current ||
        disposedRef.current ||
        (targetNodeRef.current !== null && !textEngine.isWritable())
      ) {
        return;
      }
      if (capture && !selectionCapturedRef.current) {
        captureSelection();
      }
      selectionCapturedRef.current = false;
      const acquired = await coordinator.activate(coordinatedSession);
      if (!acquired) {
        return;
      }
      if (
        disabledRef.current ||
        disposedRef.current ||
        (targetNodeRef.current !== null && !textEngine.isWritable())
      ) {
        coordinator.release(coordinatedSession);
        return;
      }
      await session.start();
      const status = session.getSnapshot().status;
      if (status === "idle" || status === "error") {
        coordinator.release(coordinatedSession);
      }
    },
    [captureSelection, coordinatedSession, coordinator, session, textEngine],
  );

  const start = useCallback(() => startInternal(true), [startInternal]);
  const stop = useCallback(
    async (reason: VoiceInputStopReason = "user") => {
      await session.stop(reason);
      coordinator.release(coordinatedSession);
    },
    [coordinatedSession, coordinator, session],
  );
  const cancel = useCallback(async () => {
    await session.cancel();
    coordinator.release(coordinatedSession);
  }, [coordinatedSession, coordinator, session]);
  const toggle = useCallback(async () => {
    const status = session.getSnapshot().status;
    if (status === "idle" || status === "error") {
      await startInternal(true);
    } else {
      await stop();
    }
  }, [session, startInternal, stop]);

  const targetRef = useCallback(
    (target: VoiceInputTextTarget | null) => {
      const previousTarget = targetNodeRef.current;
      targetNodeRef.current = target;
      if (target === null && previousTarget !== null) {
        void stop("replaced");
      }
      textEngine.setTarget(target);
    },
    [stop, textEngine],
  );

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      coordinator.cancel(coordinatedSession);
      void session.stop("replaced").then(
        () => coordinator.release(coordinatedSession),
        () => coordinator.release(coordinatedSession),
      );
    };
  }, [coordinatedSession, coordinator, session]);

  const releaseHold = useCallback(() => {
    if (heldPointerRef.current === null && heldKeyRef.current === null) {
      return;
    }
    heldPointerRef.current = null;
    heldKeyRef.current = null;
    void stop();
  }, [stop]);

  useEffect(() => {
    if (disabled) {
      releaseHold();
    }
  }, [disabled, releaseHold]);

  useEffect(() => {
    window.addEventListener("blur", releaseHold);
    return () => window.removeEventListener("blur", releaseHold);
  }, [releaseHold]);

  const [targetWritable, setTargetWritable] = useState(true);
  useIsomorphicLayoutEffect(() => {
    const target = targetNodeRef.current;
    const update = (): void =>
      setTargetWritable(target === null || textEngine.isWritable());
    update();
    if (target === null) return;
    const observer = new MutationObserver(update);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["disabled", "readonly", "type"],
    });
    for (
      let ancestor = target.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    }
    return () => observer.disconnect();
  });
  useEffect(() => {
    if (disabled || !targetWritable) void stop("target-unavailable");
  }, [disabled, targetWritable, stop]);
  const resolvedDisabled = disabled || !targetWritable || !isSupported;
  const active = snapshot.status !== "idle" && snapshot.status !== "error";
  const activationMode = options.activationMode ?? "toggle";
  const triggerProps = useMemo<VoiceInputTriggerProps>(
    () => ({
      type: "button",
      disabled: resolvedDisabled,
      "aria-pressed": active,
      onPointerDown(event) {
        if (resolvedDisabled || event.button !== 0) {
          return;
        }
        event.preventDefault();
        if (isStartable(session.getSnapshot().status)) {
          captureSelection();
        }
        if (activationMode === "hold") {
          heldPointerRef.current = event.pointerId;
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // Pointer capture is an enhancement; some synthetic or older
            // browser pointer implementations reject it.
          }
          void startInternal(false);
        }
      },
      onPointerUp(event) {
        if (
          activationMode === "hold" &&
          heldPointerRef.current === event.pointerId
        ) {
          heldPointerRef.current = null;
          try {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          } catch {
            // The pointer may already have been released by the browser.
          }
          void stop();
        }
      },
      onPointerCancel(event) {
        if (
          activationMode === "hold" &&
          heldPointerRef.current === event.pointerId
        ) {
          heldPointerRef.current = null;
          void stop();
        }
      },
      onLostPointerCapture() {
        releaseHold();
      },
      onBlur() {
        if (heldKeyRef.current !== null) {
          releaseHold();
        }
      },
      onClick(event) {
        if (resolvedDisabled || activationMode === "hold") {
          event.preventDefault();
          return;
        }
        void toggle();
      },
      onKeyDown(event) {
        if (resolvedDisabled || !ACTIVE_KEYS.has(event.key) || event.repeat) {
          return;
        }
        if (isStartable(session.getSnapshot().status)) {
          captureSelection();
        }
        if (activationMode === "hold") {
          event.preventDefault();
          heldKeyRef.current = event.key;
          void startInternal(false);
        }
      },
      onKeyUp(event) {
        if (activationMode === "hold" && heldKeyRef.current === event.key) {
          event.preventDefault();
          heldKeyRef.current = null;
          void stop();
        }
      },
    }),
    [
      activationMode,
      active,
      captureSelection,
      releaseHold,
      resolvedDisabled,
      session,
      startInternal,
      stop,
      toggle,
    ],
  );
  const getTriggerProps = useCallback(
    (props: ButtonHTMLAttributes<HTMLButtonElement> = {}) =>
      composeTriggerProps(triggerProps, props),
    [triggerProps],
  );

  return useMemo(
    () => ({
      ...snapshot,
      targetRef,
      triggerProps,
      getTriggerProps,
      isSupported,
      getTextSnapshot,
      undo,
      redo,
      start,
      stop,
      cancel,
      toggle,
    }),
    [
      cancel,
      getTriggerProps,
      getTextSnapshot,
      undo,
      redo,
      isSupported,
      snapshot,
      start,
      stop,
      targetRef,
      toggle,
      triggerProps,
    ],
  );
}

function composeTriggerProps(
  trigger: VoiceInputTriggerProps,
  props: ButtonHTMLAttributes<HTMLButtonElement>,
): ButtonHTMLAttributes<HTMLButtonElement> & VoiceInputTriggerProps {
  return {
    ...props,
    type: props.type ?? trigger.type,
    disabled: props.disabled === true || trigger.disabled,
    "aria-pressed": trigger["aria-pressed"],
    onBlur: composeEventHandlers(props.onBlur, trigger.onBlur),
    onClick: composeEventHandlers(props.onClick, trigger.onClick),
    onKeyDown: composeEventHandlers(props.onKeyDown, trigger.onKeyDown),
    onKeyUp: composeEventHandlers(props.onKeyUp, trigger.onKeyUp),
    onLostPointerCapture: composeEventHandlers(
      props.onLostPointerCapture,
      trigger.onLostPointerCapture,
    ),
    onPointerCancel: composeEventHandlers(
      props.onPointerCancel,
      trigger.onPointerCancel,
    ),
    onPointerDown: composeEventHandlers(
      props.onPointerDown,
      trigger.onPointerDown,
    ),
    onPointerUp: composeEventHandlers(props.onPointerUp, trigger.onPointerUp),
  };
}

function composeEventHandlers<E extends { readonly defaultPrevented: boolean }>(
  consumer: ((event: E) => void) | undefined,
  internal: (event: E) => void,
): (event: E) => void {
  return (event) => {
    consumer?.(event);
    if (!event.defaultPrevented) internal(event);
  };
}

function isStartable(status: VoiceInputStatus): boolean {
  return status === "idle" || status === "error";
}

function dispatchCallback(
  callbacks: UseVoiceInputOptions,
  event: VoiceInputSessionEvent,
): void {
  callbacks.onEvent?.(event);
  switch (event.type) {
    case "status-change": {
      callbacks.onStatusChange?.(event.status, event.previousStatus);
      break;
    }
    case "interim": {
      callbacks.onInterimTranscript?.(event.text);
      if (event.transcriptChanged) {
        callbacks.onTranscriptChange?.(event.transcript);
      }
      break;
    }
    case "final": {
      callbacks.onFinalTranscriptPart?.(event.text);
      if (event.finalTranscriptChanged) {
        callbacks.onFinalTranscript?.(event.transcript);
      }
      if (event.transcriptChanged) {
        callbacks.onTranscriptChange?.(event.transcript);
      }
      break;
    }
    case "text-limit": {
      callbacks.onTextLimit?.(event);
      break;
    }
    case "duration-warning": {
      callbacks.onDurationWarning?.(event.remainingMs, event.maxDurationMs);
      break;
    }
    case "stop": {
      callbacks.onStop?.(event.reason);
      break;
    }
    case "error": {
      callbacks.onError?.(event.error);
      break;
    }
    case "cancel": {
      break;
    }
    case "speech-start":
    case "speech-end": {
      break;
    }
  }
}
