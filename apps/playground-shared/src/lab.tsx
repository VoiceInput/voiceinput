"use client";

import {
  VoiceInputError,
  type VoiceInputSessionEvent,
  type VoiceInputStatus,
  type VoiceInputTextEngineSnapshot,
} from "@voiceinput/core";
import { deepgram } from "@voiceinput/deepgram";
import { elevenlabs } from "@voiceinput/elevenlabs";
import { openai } from "@voiceinput/openai";
import { VoiceInputProvider, useVoiceInput } from "@voiceinput/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  createLabFakeRuntime,
  createSilentAudioSource,
  type LabFakeRuntime,
} from "./fixtures.js";

type ProviderChoice = "fake" | "openai" | "elevenlabs" | "deepgram";
type FieldId = "controlled" | "uncontrolled";
type InterimBehavior = "inline" | "expose";
type ActivationMode = "toggle" | "hold";
type TransformMode = "none" | "success" | "failure" | "timeout";

interface LabConfiguration {
  readonly provider: ProviderChoice;
  readonly interimBehavior: InterimBehavior;
  readonly activationMode: ActivationMode;
  readonly transformMode: TransformMode;
  readonly maxDurationMs: number;
  readonly endpointing: "default" | "manual" | "fast";
}

interface LabEvent {
  readonly id: number;
  readonly time: string;
  readonly source: string;
  readonly type: string;
  readonly detail?: unknown;
}

interface FieldHandle {
  isStartable(): boolean;
  isListening(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  selectPhrase(): void;
  moveCaret(): void;
  appendManualEdit(): void;
  externalUpdate(): void;
}

export interface VoiceInputLabProps {
  readonly runtime: "Next.js App Router" | "Vite + Hono";
  readonly tokenEndpoint?: string;
  readonly authEndpoint?: string;
}

const initialConfiguration: LabConfiguration = {
  provider: "fake",
  interimBehavior: "inline",
  activationMode: "toggle",
  transformMode: "none",
  maxDurationMs: 5 * 60 * 1_000,
  endpointing: "default",
};

function providerTokenEndpoint(
  endpoint: string,
  provider: Exclude<ProviderChoice, "fake">,
): string {
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}provider=${provider}`;
}

export function VoiceInputLab({
  runtime,
  tokenEndpoint = "/api/voice-token",
  authEndpoint = "/api/dev-auth",
}: VoiceInputLabProps): React.JSX.Element {
  const fakeRuntime = useMemo(() => createLabFakeRuntime(), []);
  const fakeAudioSource = useMemo(() => createSilentAudioSource(), []);
  const [configuration, setConfiguration] =
    useState<LabConfiguration>(initialConfiguration);
  const provider = useMemo(() => {
    switch (configuration.provider) {
      case "fake":
        return fakeRuntime.provider;
      case "openai":
        return openai({
          tokenEndpoint: providerTokenEndpoint(tokenEndpoint, "openai"),
        });
      case "elevenlabs":
        return elevenlabs({
          tokenEndpoint: providerTokenEndpoint(tokenEndpoint, "elevenlabs"),
        });
      case "deepgram":
        return deepgram({
          tokenEndpoint: providerTokenEndpoint(tokenEndpoint, "deepgram"),
        });
    }
  }, [configuration.provider, fakeRuntime.provider, tokenEndpoint]);

  return (
    <VoiceInputProvider
      key={configuration.provider}
      provider={provider}
      {...(configuration.provider === "fake"
        ? { audioSource: fakeAudioSource }
        : {})}
    >
      <LabWorkspace
        authEndpoint={authEndpoint}
        configuration={configuration}
        fakeRuntime={fakeRuntime}
        runtime={runtime}
        setConfiguration={setConfiguration}
      />
    </VoiceInputProvider>
  );
}

function LabWorkspace({
  authEndpoint,
  configuration,
  fakeRuntime,
  runtime,
  setConfiguration,
}: {
  authEndpoint: string;
  configuration: LabConfiguration;
  fakeRuntime: LabFakeRuntime;
  runtime: VoiceInputLabProps["runtime"];
  setConfiguration: React.Dispatch<React.SetStateAction<LabConfiguration>>;
}): React.JSX.Element {
  const unstyledRuntime = useMemo(() => createLabFakeRuntime(), []);
  const unstyledAudioSource = useMemo(() => createSilentAudioSource(), []);
  const [activeField, setActiveField] = useState<FieldId>("controlled");
  const [events, setEvents] = useState<readonly LabEvent[]>([]);
  const [diagnostics, setDiagnostics] = useState<
    Partial<Record<FieldId, VoiceInputTextEngineSnapshot>>
  >({});
  const [authState, setAuthState] = useState("not checked");
  const handles = useRef(new Map<FieldId, FieldHandle>());
  const eventId = useRef(0);

  const log = useCallback(
    (source: string, type: string, detail?: unknown): void => {
      const nextEvent: LabEvent = {
        id: eventId.current++,
        time: new Date().toISOString().slice(11, 23),
        source,
        type,
        ...(detail === undefined ? {} : { detail }),
      };
      setEvents((current) => [nextEvent, ...current].slice(0, 80));
    },
    [],
  );

  const register = useCallback(
    (id: FieldId, handle: FieldHandle | null): void => {
      if (handle === null) {
        handles.current.delete(id);
      } else {
        handles.current.set(id, handle);
      }
    },
    [],
  );

  const updateDiagnostics = useCallback(
    (id: FieldId, snapshot: VoiceInputTextEngineSnapshot): void => {
      setDiagnostics((current) => ({ ...current, [id]: snapshot }));
    },
    [],
  );

  const getActiveHandle = useCallback((): FieldHandle | undefined => {
    const handle = handles.current.get(activeField);
    if (handle === undefined) {
      log("lab", "scenario-unavailable", { activeField });
    }
    return handle;
  }, [activeField, log]);

  const fakeOnly = useCallback(
    (action: () => void): void => {
      if (configuration.provider !== "fake") {
        log("lab", "fake-scenario-blocked", {
          message: "Switch the provider to Fake before running this scenario.",
        });
        return;
      }
      try {
        action();
      } catch (error) {
        log("lab", "scenario-error", normalizeUnknownError(error));
      }
    },
    [configuration.provider, log],
  );

  const withListeningFake = useCallback(
    (action: (handle: FieldHandle) => void): void => {
      fakeOnly(() => {
        const handle = getActiveHandle();
        if (handle === undefined) {
          return;
        }
        if (!handle.isListening()) {
          log("fake", "scenario-blocked", {
            message: "Start the active fake session before emitting a final.",
          });
          return;
        }
        action(handle);
      });
    },
    [fakeOnly, getActiveHandle, log],
  );

  const runAuthControl = useCallback(
    async (mode: "login" | "logout" | "expired"): Promise<void> => {
      try {
        const response = await fetch(authEndpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const body = (await response.json()) as unknown;
        setAuthState(response.ok ? mode : `failed (${response.status})`);
        log("auth", mode, { status: response.status, body });
      } catch (error) {
        setAuthState("unreachable");
        log("auth", "network-error", normalizeUnknownError(error));
      }
    },
    [authEndpoint, log],
  );

  const runDelayedFinal = useCallback((): void => {
    withListeningFake((handle) => {
      const session = fakeRuntime.captureCurrentSession();
      fakeRuntime.keepNextFinishOpen();
      void handle.stop();
      session.emit({ type: "speech-end" });
      log("fake", "delayed-final-scheduled", { delayMs: 900 });
      window.setTimeout(() => {
        fakeOnly(() => {
          session.emit({
            type: "final",
            text: "delayed final arrived safely",
          });
          session.close();
        });
      }, 900);
    });
  }, [fakeOnly, fakeRuntime, log, withListeningFake]);

  const runContention = useCallback(async (): Promise<void> => {
    const first = handles.current.get("controlled");
    const second = handles.current.get("uncontrolled");
    if (first === undefined || second === undefined) {
      return;
    }
    await first.start();
    await second.start();
    setActiveField("uncontrolled");
    log("lab", "two-field-contention", {
      expected: "controlled stops with replaced; uncontrolled listens",
    });
  }, [log]);

  const runStartFailure = useCallback(
    (failure: "connection" | "validation"): void => {
      fakeOnly(() => {
        const handle = getActiveHandle();
        if (handle === undefined) {
          return;
        }
        if (!handle.isStartable()) {
          log("fake", "scenario-blocked", {
            message: "Stop or cancel the active session before this scenario.",
          });
          return;
        }
        if (failure === "connection") {
          fakeRuntime.rejectNextConnection();
        } else {
          fakeRuntime.rejectNextValidation();
        }
        void handle.start();
      });
    },
    [fakeOnly, fakeRuntime, getActiveHandle, log],
  );

  const updateConfiguration = <Key extends keyof LabConfiguration>(
    key: Key,
    value: LabConfiguration[Key],
  ): void => {
    setConfiguration((current) => ({ ...current, [key]: value }));
    log("config", String(key), value);
  };

  const activeSnapshot = diagnostics[activeField];

  return (
    <main className="voice-lab">
      <header className="voice-lab__header">
        <div>
          <p className="voice-lab__eyebrow">
            VoiceInput / maintainer workspace
          </p>
          <h1>Voice Lab</h1>
        </div>
        <div className="voice-lab__runtime">
          <span className="voice-lab__signal" aria-hidden="true" />
          <span>{runtime}</span>
          <span className="voice-lab__muted">auth: {authState}</span>
        </div>
      </header>

      <div className="voice-lab__layout">
        <aside className="voice-lab__rail" aria-label="Lab configuration">
          <SectionLabel index="01" label="Session configuration" />
          <Control label="Provider">
            <select
              value={configuration.provider}
              onChange={(event) =>
                updateConfiguration(
                  "provider",
                  event.currentTarget.value as ProviderChoice,
                )
              }
            >
              <option value="fake">Fake / deterministic</option>
              <option value="openai">OpenAI / live</option>
              <option value="elevenlabs">ElevenLabs / live</option>
              <option value="deepgram">Deepgram / live</option>
            </select>
          </Control>
          <SegmentedControl
            label="Interim ownership"
            value={configuration.interimBehavior}
            options={[
              ["inline", "Inline"],
              ["expose", "Exposed"],
            ]}
            onChange={(value) => updateConfiguration("interimBehavior", value)}
          />
          <SegmentedControl
            label="Activation"
            value={configuration.activationMode}
            options={[
              ["toggle", "Toggle"],
              ["hold", "Hold"],
            ]}
            onChange={(value) => updateConfiguration("activationMode", value)}
          />
          <Control label="Transcript transform">
            <select
              value={configuration.transformMode}
              onChange={(event) =>
                updateConfiguration(
                  "transformMode",
                  event.currentTarget.value as TransformMode,
                )
              }
            >
              <option value="none">None</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="timeout">Timeout (700 ms)</option>
            </select>
          </Control>
          <Control label="Maximum duration">
            <select
              value={configuration.maxDurationMs}
              onChange={(event) =>
                updateConfiguration(
                  "maxDurationMs",
                  Number(event.currentTarget.value),
                )
              }
            >
              <option value={300_000}>5 minutes</option>
              <option value={1_500}>1.5 second simulation</option>
            </select>
          </Control>
          <Control label="Endpointing">
            <select
              value={configuration.endpointing}
              onChange={(event) =>
                updateConfiguration(
                  "endpointing",
                  event.currentTarget.value as LabConfiguration["endpointing"],
                )
              }
            >
              <option value="default">Provider default</option>
              <option value="manual">Manual commit</option>
              <option value="fast">650 ms silence</option>
            </select>
          </Control>

          <SectionLabel index="02" label="Local auth fixture" />
          <p className="voice-lab__hint">
            Development-only, signed, HttpOnly, and loopback-restricted.
          </p>
          <div className="voice-lab__button-stack">
            <button type="button" onClick={() => void runAuthControl("login")}>
              Issue local session
            </button>
            <button
              type="button"
              onClick={() => void runAuthControl("expired")}
            >
              Issue expired session
            </button>
            <button type="button" onClick={() => void runAuthControl("logout")}>
              Clear session
            </button>
          </div>
        </aside>

        <section className="voice-lab__workspace" aria-label="Voice field lab">
          <div className="voice-lab__workspace-heading">
            <div>
              <SectionLabel index="03" label="Text ownership" />
              <p>
                Move the caret, replace a selection, type during interim text,
                or start the other field while this one is active.
              </p>
            </div>
            <FieldPicker value={activeField} onChange={setActiveField} />
          </div>

          <LabField
            id="controlled"
            label="Controlled textarea"
            controlled
            active={activeField === "controlled"}
            configuration={configuration}
            log={log}
            onActivate={setActiveField}
            onDiagnostics={updateDiagnostics}
            register={register}
          />
          <LabField
            id="uncontrolled"
            label="Uncontrolled textarea"
            active={activeField === "uncontrolled"}
            configuration={configuration}
            log={log}
            onActivate={setActiveField}
            onDiagnostics={updateDiagnostics}
            register={register}
          />

          <div className="voice-lab__scenario-strip" aria-label="Field actions">
            <button
              type="button"
              onClick={() => getActiveHandle()?.selectPhrase()}
            >
              Select phrase
            </button>
            <button
              type="button"
              onClick={() => getActiveHandle()?.moveCaret()}
            >
              Move caret
            </button>
            <button
              type="button"
              onClick={() => getActiveHandle()?.appendManualEdit()}
            >
              Manual edit
            </button>
            <button
              type="button"
              onClick={() => getActiveHandle()?.externalUpdate()}
            >
              External update
            </button>
            <button type="button" onClick={() => void runContention()}>
              Run contention
            </button>
          </div>

          <details className="voice-lab__unstyled">
            <summary>Unstyled hook specimen</summary>
            <VoiceInputProvider
              provider={unstyledRuntime.provider}
              audioSource={unstyledAudioSource}
            >
              <BareField log={log} />
            </VoiceInputProvider>
          </details>
        </section>

        <aside className="voice-lab__inspector" aria-label="Lab inspector">
          <SectionLabel index="04" label="Scenario runner" />
          <div
            className="voice-lab__button-grid"
            onPointerDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => void getActiveHandle()?.start()}
            >
              Start active
            </button>
            <button
              type="button"
              onClick={() =>
                fakeOnly(() => {
                  fakeRuntime.emit({ type: "speech-start" });
                  fakeRuntime.emit({ type: "interim", text: "hel" });
                  fakeRuntime.emit({ type: "interim", text: "hello" });
                })
              }
            >
              Revise interim
            </button>
            <button
              type="button"
              onClick={() =>
                withListeningFake((handle) => {
                  fakeRuntime.keepNextFinishOpen();
                  void handle.stop();
                  fakeRuntime.emit({ type: "speech-end" });
                  fakeRuntime.emit({
                    type: "final",
                    text: "hello from VoiceInput",
                  });
                  fakeRuntime.close();
                })
              }
            >
              Emit final
            </button>
            <button type="button" onClick={runDelayedFinal}>
              Delayed final
            </button>
            <button type="button" onClick={() => runStartFailure("connection")}>
              Connection error
            </button>
            <button type="button" onClick={() => runStartFailure("validation")}>
              Unsupported option
            </button>
            <button
              type="button"
              onClick={() => void getActiveHandle()?.cancel()}
            >
              Cancel active
            </button>
            <button
              type="button"
              onClick={() => setEvents([])}
              className="voice-lab__quiet-button"
            >
              Clear events
            </button>
          </div>

          <SectionLabel index="05" label="Owned spans" />
          <div className="voice-lab__spans">
            {activeSnapshot?.spans.length ? (
              activeSnapshot.spans.map((span) => (
                <div key={span.id} className="voice-lab__span-row">
                  <span>{span.state}</span>
                  <code>
                    {span.start}:{span.end}
                  </code>
                  <q>{span.text}</q>
                </div>
              ))
            ) : (
              <p className="voice-lab__empty">No voice-owned text.</p>
            )}
          </div>

          <SectionLabel index="06" label="Normalized event stream" />
          <div className="voice-lab__events">
            {events.length === 0 ? (
              <p className="voice-lab__empty">Waiting for an interaction.</p>
            ) : (
              events.map((event) => (
                <div className="voice-lab__event" key={event.id}>
                  <time>{event.time}</time>
                  <strong>{event.source}</strong>
                  <span>{event.type}</span>
                  {event.detail === undefined ? null : (
                    <code>{formatDetail(event.detail)}</code>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function LabField({
  active,
  configuration,
  controlled = false,
  id,
  label,
  log,
  onActivate,
  onDiagnostics,
  register,
}: {
  active: boolean;
  configuration: LabConfiguration;
  controlled?: boolean;
  id: FieldId;
  label: string;
  log: (source: string, type: string, detail?: unknown) => void;
  onActivate: (id: FieldId) => void;
  onDiagnostics: (id: FieldId, snapshot: VoiceInputTextEngineSnapshot) => void;
  register: (id: FieldId, handle: FieldHandle | null) => void;
}): React.JSX.Element {
  const initialValue = `This is the ${controlled ? "controlled" : "uncontrolled"} field. Replace this phrase, move the caret, or type while dictating.`;
  const [value, setValue] = useState(initialValue);
  const [observedValue, setObservedValue] = useState(initialValue);
  const target = useRef<HTMLTextAreaElement | null>(null);
  const transformTranscript = useMemo(
    () => createTransform(configuration.transformMode),
    [configuration.transformMode],
  );
  const endpointing =
    configuration.endpointing === "manual"
      ? false
      : configuration.endpointing === "fast"
        ? { silenceMs: 650 }
        : undefined;
  const voice = useVoiceInput({
    ...(controlled ? { value, onValueChange: setValue } : {}),
    activationMode: configuration.activationMode,
    interimBehavior: configuration.interimBehavior,
    maxDurationMs: configuration.maxDurationMs,
    language: "en-CA",
    vocabulary: ["VoiceInput", "WebSocket", "TypeScript"],
    ...(endpointing === undefined ? {} : { endpointing }),
    ...(transformTranscript === undefined ? {} : { transformTranscript }),
    transformTimeoutMs: 700,
    onEvent(event) {
      log(id, event.type, normalizeSessionEventDetail(event));
    },
  });
  const {
    cancel: cancelVoice,
    getTextSnapshot,
    start: startVoice,
    stop: stopVoice,
    targetRef,
  } = voice;

  const setTarget = useCallback(
    (node: HTMLTextAreaElement | null): void => {
      target.current = node;
      targetRef(node);
      if (node !== null) {
        setObservedValue(node.value);
      }
    },
    [targetRef],
  );

  const dispatchInput = useCallback((nextValue: string): void => {
    const node = target.current;
    if (node === null) {
      return;
    }
    node.value = nextValue;
    node.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, []);

  const refreshDiagnostics = useCallback((): void => {
    queueMicrotask(() => onDiagnostics(id, getTextSnapshot()));
  }, [getTextSnapshot, id, onDiagnostics]);

  const handle = useMemo<FieldHandle>(
    () => ({
      isStartable: () => voice.status === "idle" || voice.status === "error",
      isListening: () => voice.status === "listening",
      start: () => startVoice(),
      stop: () => stopVoice(),
      cancel: () => cancelVoice(),
      selectPhrase() {
        const node = target.current;
        if (node === null) {
          return;
        }
        const start = node.value.indexOf("Replace this phrase");
        node.focus();
        node.setSelectionRange(start, start + "Replace this phrase".length);
        node.dispatchEvent(new Event("select", { bubbles: true }));
        refreshDiagnostics();
        log(id, "selection", { start, end: node.selectionEnd });
      },
      moveCaret() {
        const node = target.current;
        if (node === null) {
          return;
        }
        const position = Math.min(12, node.value.length);
        node.focus();
        node.setSelectionRange(position, position);
        node.dispatchEvent(new Event("select", { bubbles: true }));
        refreshDiagnostics();
        log(id, "caret-moved", { position });
      },
      appendManualEdit() {
        const nextValue = `${target.current?.value ?? value} [manual edit]`;
        if (controlled) {
          setValue(nextValue);
          setObservedValue(nextValue);
        } else {
          dispatchInput(nextValue);
        }
        log(id, "manual-edit");
      },
      externalUpdate() {
        if (controlled) {
          const nextValue = `${value} [external update]`;
          setValue(nextValue);
          setObservedValue(nextValue);
          log(id, "external-controlled-update");
        } else {
          log(id, "external-update-skipped", {
            message: "This action applies to the controlled field.",
          });
        }
      },
    }),
    [
      controlled,
      dispatchInput,
      id,
      log,
      refreshDiagnostics,
      value,
      voice.status,
      cancelVoice,
      startVoice,
      stopVoice,
    ],
  );

  useEffect(() => {
    register(id, handle);
    return () => register(id, null);
  }, [handle, id, register]);

  const diagnosticKey = JSON.stringify({
    value: controlled ? value : observedValue,
    status: voice.status,
    transcript: voice.transcript,
    interim: voice.interimTranscript,
  });
  useEffect(() => {
    onDiagnostics(id, getTextSnapshot());
    // The key deliberately samples the engine after field/session changes.
  }, [diagnosticKey, getTextSnapshot, id, onDiagnostics]);

  const onInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    setObservedValue(event.currentTarget.value);
    log(id, "native-input", {
      valueLength: event.currentTarget.value.length,
    });
  };
  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    if (controlled) {
      setValue(event.currentTarget.value);
    }
  };

  return (
    <article
      className="voice-lab__field"
      data-active={active || undefined}
      data-status={voice.status}
      onFocusCapture={() => onActivate(id)}
    >
      <div className="voice-lab__field-meta">
        <div>
          <span className="voice-lab__field-kind">
            {controlled ? "React state" : "Native DOM"}
          </span>
          <h2>{label}</h2>
        </div>
        <Status status={voice.status} supported={voice.isSupported} />
      </div>
      <textarea
        aria-label={label}
        ref={setTarget}
        {...(controlled ? { value } : { defaultValue: initialValue })}
        onChange={onChange}
        onInput={onInput}
        onSelect={refreshDiagnostics}
        spellCheck={false}
      />
      <div className="voice-lab__field-footer">
        <button
          className="voice-lab__voice-button"
          aria-label={`${configuration.activationMode === "hold" ? "Hold to dictate into" : "Toggle dictation for"} ${label}`}
          {...voice.triggerProps}
        >
          <span aria-hidden="true" />
          {configuration.activationMode === "hold" ? "Hold to speak" : "Speak"}
        </button>
        {configuration.interimBehavior === "expose" ? (
          <output className="voice-lab__interim" aria-live="polite">
            {voice.interimTranscript || "Interim transcript appears here"}
          </output>
        ) : (
          <span className="voice-lab__field-note">
            Interim text owns the field
          </span>
        )}
      </div>
      <output className="voice-lab__sr-status" aria-live="polite">
        {label}: {voice.status}
      </output>
      {voice.error === null ? null : (
        <p className="voice-lab__error" role="alert">
          {voice.error.code}: {voice.error.message}
        </p>
      )}
    </article>
  );
}

function BareField({
  log,
}: {
  log: (source: string, type: string, detail?: unknown) => void;
}): React.JSX.Element {
  const voice = useVoiceInput({
    onEvent: (event) =>
      log("unstyled", event.type, normalizeSessionEventDetail(event)),
  });
  const { status, targetRef, triggerProps } = voice;
  return (
    <div className="voice-lab__bare">
      <input ref={targetRef} aria-label="Unstyled voice input" />
      <button {...triggerProps}>Speak</button>
      <output>{status}</output>
    </div>
  );
}

function Control({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <label className="voice-lab__control">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SegmentedControl<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly (readonly [Value, string])[];
  value: Value;
}): React.JSX.Element {
  return (
    <fieldset className="voice-lab__control">
      <legend>{label}</legend>
      <span className="voice-lab__segments">
        {options.map(([option, optionLabel]) => (
          <button
            key={option}
            type="button"
            data-selected={value === option || undefined}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {optionLabel}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

function FieldPicker({
  onChange,
  value,
}: {
  onChange: (value: FieldId) => void;
  value: FieldId;
}): React.JSX.Element {
  return (
    <div className="voice-lab__field-picker" aria-label="Active scenario field">
      <button
        type="button"
        aria-pressed={value === "controlled"}
        onClick={() => onChange("controlled")}
      >
        A / controlled
      </button>
      <button
        type="button"
        aria-pressed={value === "uncontrolled"}
        onClick={() => onChange("uncontrolled")}
      >
        B / uncontrolled
      </button>
    </div>
  );
}

function SectionLabel({
  index,
  label,
}: {
  index: string;
  label: string;
}): React.JSX.Element {
  return (
    <div className="voice-lab__section-label">
      <span>{index}</span>
      <h2>{label}</h2>
    </div>
  );
}

function Status({
  status,
  supported,
}: {
  status: VoiceInputStatus;
  supported: boolean;
}): React.JSX.Element {
  return (
    <span className="voice-lab__status" data-status={status}>
      <i aria-hidden="true" />
      {supported ? status : "unsupported browser"}
    </span>
  );
}

function createTransform(
  mode: TransformMode,
): ((text: string) => Promise<string>) | undefined {
  if (mode === "none") {
    return undefined;
  }
  if (mode === "timeout") {
    return async () => await new Promise<string>(() => {});
  }
  if (mode === "failure") {
    return async () => {
      throw new Error("Synthetic transform failure.");
    };
  }
  return async (text) => {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return `${text.replaceAll("voice input", "VoiceInput").trim()} — transformed`;
  };
}

function normalizeSessionEventDetail(event: VoiceInputSessionEvent): unknown {
  switch (event.type) {
    case "status-change":
      return {
        previousStatus: event.previousStatus,
        status: event.status,
      };
    case "interim":
    case "final":
      return { text: event.text };
    case "duration-warning":
      return {
        remainingMs: event.remainingMs,
        maxDurationMs: event.maxDurationMs,
      };
    case "stop":
      return { reason: event.reason };
    case "error":
      return normalizeVoiceError(event.error);
    case "cancel":
    case "speech-start":
    case "speech-end":
      return undefined;
  }
}

function normalizeVoiceError(error: VoiceInputError): Record<string, unknown> {
  return {
    code: error.code,
    message: error.message,
    provider: error.provider,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
  };
}

function normalizeUnknownError(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { value: String(error) };
}

function formatDetail(detail: unknown): string {
  return JSON.stringify(detail);
}
