import {
  VoiceInputError,
  type VoiceInputErrorCode,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1Session,
  type VoiceInputProviderV1StreamPart,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";
import { z } from "zod";

import type { VoiceInputTextEngine } from "./text-engine.js";

export { VoiceInputError };
export type {
  VoiceInputErrorCode,
  VoiceInputErrorOptions,
} from "@voiceinput/provider";

const DEFAULT_MAX_DURATION_MS = 300_000;
const DURATION_WARNING_MS = 30_000;
const FINALIZATION_TIMEOUT_MS = 5_000;

const languageSchema = z.string().refine(isValidLanguage, {
  message: "language must be a valid BCP 47 language tag without whitespace.",
});

const vocabularySchema = z
  .array(
    z.string().refine((term) => term.length > 0 && term === term.trim(), {
      message:
        "Vocabulary terms must be non-empty and have no outer whitespace.",
    }),
  )
  .readonly();

const endpointingSchema = z.union([
  z.literal(false),
  z
    .object({
      silenceMs: z.number().int().positive(),
    })
    .strict(),
]);

const sessionConfigurationSchema = z
  .object({
    language: languageSchema.optional(),
    vocabulary: vocabularySchema.optional(),
    endpointing: endpointingSchema.optional(),
    maxDurationMs: z.number().int().positive().optional(),
  })
  .strict();

export type VoiceInputStatus =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "listening"
  | "stopping"
  | "processing"
  | "error";

export type VoiceInputStopReason = "user" | "max-duration" | "replaced";

export interface VoiceInputSnapshot {
  readonly status: VoiceInputStatus;
  readonly transcript: string;
  readonly interimTranscript: string;
  readonly finalTranscript: string;
  readonly error: VoiceInputError | null;
}

export type VoiceInputSessionEvent =
  | {
      type: "status-change";
      previousStatus: VoiceInputStatus;
      status: VoiceInputStatus;
    }
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | {
      type: "duration-warning";
      remainingMs: number;
      maxDurationMs: number;
    }
  | { type: "stop"; reason: VoiceInputStopReason }
  | { type: "cancel" }
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "error"; error: VoiceInputError };

export interface VoiceAudioSourcePrepareOptions {
  sampleRate: number;
  abortSignal: AbortSignal;
}

export interface PreparedVoiceAudioSource {
  readonly stream: ReadableStream<Int16Array>;
  start(): PromiseLike<void> | void;
  stop(): PromiseLike<void> | void;
  abort(reason?: unknown): void;
}

export interface VoiceAudioSource {
  prepare(
    options: VoiceAudioSourcePrepareOptions,
  ): PromiseLike<PreparedVoiceAudioSource>;
}

export interface CreateVoiceInputSessionOptions extends VoiceTranscriptionOptions {
  provider: VoiceInputProviderV1;
  audioSource: VoiceAudioSource;
  textEngine?: VoiceInputTextEngine;
  maxDurationMs?: number;
}

export interface VoiceInputSession {
  getSnapshot(): VoiceInputSnapshot;
  subscribe(listener: (event: VoiceInputSessionEvent) => void): () => void;
  start(): Promise<void>;
  stop(reason?: VoiceInputStopReason): Promise<void>;
  cancel(): Promise<void>;
  toggle(): Promise<void>;
}

interface SessionConfiguration extends VoiceTranscriptionOptions {
  maxDurationMs: number;
}

interface ActiveRun {
  abortController: AbortController;
  audio?: PreparedVoiceAudioSource;
  providerSession?: VoiceInputProviderV1Session;
  audioTask?: Promise<void>;
  providerTask?: Promise<void>;
  stopPromise?: Promise<void>;
  warningTimer?: ReturnType<typeof setTimeout>;
  durationTimer?: ReturnType<typeof setTimeout>;
}

export function createVoiceInputSession(
  options: CreateVoiceInputSessionOptions,
): VoiceInputSession {
  assertProvider(options.provider);
  assertAudioSource(options.audioSource);
  if (options.textEngine !== undefined) {
    assertTextEngine(options.textEngine);
  }

  const result = sessionConfigurationSchema.safeParse({
    language: options.language,
    vocabulary: options.vocabulary,
    endpointing: options.endpointing,
    maxDurationMs: options.maxDurationMs,
  });

  if (!result.success) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message: result.error.issues.map(formatValidationIssue).join("; "),
      cause: result.error,
    });
  }

  const configuration: SessionConfiguration = {
    ...getTranscriptionOptions(result.data),
    maxDurationMs: result.data.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
  };

  return new VoiceInputSessionController(
    options.provider,
    options.audioSource,
    options.textEngine,
    configuration,
  );
}

class VoiceInputSessionController implements VoiceInputSession {
  readonly #listeners = new Set<(event: VoiceInputSessionEvent) => void>();
  readonly #provider: VoiceInputProviderV1;
  readonly #audioSource: VoiceAudioSource;
  readonly #textEngine: VoiceInputTextEngine | undefined;
  readonly #configuration: SessionConfiguration;

  #snapshot: VoiceInputSnapshot = Object.freeze({
    status: "idle",
    transcript: "",
    interimTranscript: "",
    finalTranscript: "",
    error: null,
  });
  #activeRun: ActiveRun | undefined;

  constructor(
    provider: VoiceInputProviderV1,
    audioSource: VoiceAudioSource,
    textEngine: VoiceInputTextEngine | undefined,
    configuration: SessionConfiguration,
  ) {
    this.#provider = provider;
    this.#audioSource = audioSource;
    this.#textEngine = textEngine;
    this.#configuration = configuration;
  }

  getSnapshot(): VoiceInputSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (event: VoiceInputSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#snapshot.status !== "idle" && this.#snapshot.status !== "error") {
      return;
    }

    this.#setSnapshot({
      transcript: "",
      interimTranscript: "",
      finalTranscript: "",
      error: null,
    });

    const transcriptionOptions = getTranscriptionOptions(this.#configuration);

    try {
      this.#provider.validateOptions(transcriptionOptions);
    } catch (error) {
      this.#setPreflightError(this.#normalizeValidationError(error));
      return;
    }

    const run: ActiveRun = { abortController: new AbortController() };
    this.#textEngine?.begin();
    this.#activeRun = run;
    this.#transition("requesting-permission");

    if (!this.#isActive(run)) {
      return;
    }

    let audio: PreparedVoiceAudioSource;
    try {
      audio = await this.#audioSource.prepare({
        sampleRate: this.#provider.sampleRate,
        abortSignal: run.abortController.signal,
      });
    } catch (error) {
      if (this.#isActive(run)) {
        this.#failRun(run, this.#normalizeError(error, "audio-error"));
      }
      return;
    }

    if (!this.#isActive(run)) {
      safely(() => audio.abort("stale-session"));
      return;
    }

    run.audio = audio;
    this.#transition("connecting");

    if (!this.#isActive(run)) {
      return;
    }

    let providerSession: VoiceInputProviderV1Session;
    try {
      providerSession = await this.#provider.doOpen({
        ...transcriptionOptions,
        abortSignal: run.abortController.signal,
      });
    } catch (error) {
      if (this.#isActive(run)) {
        this.#failRun(run, this.#normalizeError(error, "provider-error"));
      }
      return;
    }

    if (!this.#isActive(run)) {
      safely(() => providerSession.abort("stale-session"));
      safely(() => audio.abort("stale-session"));
      return;
    }

    run.providerSession = providerSession;
    run.providerTask = this.#consumeProviderStream(run, providerSession);
    run.audioTask = this.#pumpAudio(run, audio.stream, providerSession);

    try {
      await audio.start();
    } catch (error) {
      if (this.#isActive(run)) {
        this.#failRun(run, this.#normalizeError(error, "audio-error"));
      }
      return;
    }

    if (!this.#isActive(run)) {
      return;
    }

    this.#transition("listening");

    if (this.#isListening(run)) {
      this.#scheduleDurationLimit(run);
    }
  }

  async stop(reason: VoiceInputStopReason = "user"): Promise<void> {
    const run = this.#activeRun;

    if (run === undefined) {
      return;
    }

    if (run.stopPromise === undefined) {
      run.stopPromise = this.#performStop(run, reason);
    }

    await run.stopPromise;
  }

  async cancel(): Promise<void> {
    const run = this.#activeRun;

    if (run === undefined) {
      return;
    }

    this.#activeRun = undefined;
    this.#abortRun(run, "cancelled");
    this.#textEngine?.cancel();
    this.#setSnapshot({
      transcript: this.#snapshot.finalTranscript,
      interimTranscript: "",
      error: null,
    });
    this.#transition("idle");
    this.#emit({ type: "cancel" });
  }

  async toggle(): Promise<void> {
    if (this.#activeRun === undefined) {
      await this.start();
    } else {
      await this.stop();
    }
  }

  async #performStop(
    run: ActiveRun,
    reason: VoiceInputStopReason,
  ): Promise<void> {
    this.#clearRunTimers(run);
    this.#transition("stopping");

    if (!this.#isActive(run)) {
      return;
    }

    const audio = run.audio;
    const providerSession = run.providerSession;
    const audioTask = run.audioTask;
    const providerTask = run.providerTask;

    if (providerSession === undefined) {
      const completed = await this.#completeTextEngine(run);
      if (!completed) {
        return;
      }
      this.#activeRun = undefined;
      this.#abortRun(run, reason);
      this.#transition("idle");
      this.#emit({ type: "stop", reason });
      return;
    }

    try {
      await withTimeout(
        (async () => {
          await audio?.stop();
          await audioTask;

          if (!this.#isActive(run)) {
            return;
          }

          await providerSession.finish();
          await providerTask;
        })(),
        FINALIZATION_TIMEOUT_MS,
        this.#provider.provider,
      );

      if (!this.#isActive(run)) {
        return;
      }

      const completed = await this.#completeTextEngine(run);
      if (!completed) {
        return;
      }

      this.#activeRun = undefined;
      this.#clearRunTimers(run);
      this.#transition("idle");
      this.#emit({ type: "stop", reason });
    } catch (error) {
      if (this.#isActive(run)) {
        this.#failRun(run, this.#normalizeError(error, "provider-error"));
      }
    }
  }

  async #consumeProviderStream(
    run: ActiveRun,
    session: VoiceInputProviderV1Session,
  ): Promise<void> {
    const reader = session.stream.getReader();

    try {
      while (this.#isActive(run)) {
        const result = await reader.read();

        if (result.done || !this.#isActive(run)) {
          break;
        }

        if (this.#handleProviderPart(run, result.value)) {
          return;
        }
      }

      if (
        this.#isActive(run) &&
        this.#snapshot.status !== "stopping" &&
        this.#snapshot.status !== "error"
      ) {
        this.#failRun(
          run,
          new VoiceInputError({
            code: "provider-error",
            message: `${this.#provider.provider} ended the transcription stream unexpectedly.`,
            provider: this.#provider.provider,
            retryable: true,
          }),
        );
      }
    } catch (error) {
      if (this.#isActive(run)) {
        this.#failRun(run, this.#normalizeError(error, "provider-error"));
      }
    } finally {
      reader.releaseLock();
    }
  }

  #handleProviderPart(
    run: ActiveRun,
    part: VoiceInputProviderV1StreamPart,
  ): boolean {
    if (!this.#isActive(run)) {
      return true;
    }

    switch (part.type) {
      case "interim": {
        this.#textEngine?.applyInterim(part.text);
        this.#setSnapshot({
          interimTranscript: part.text,
          transcript: `${this.#snapshot.finalTranscript}${part.text}`,
        });
        this.#emit({ type: "interim", text: part.text });
        return false;
      }
      case "final": {
        this.#textEngine?.applyFinal(part.text);
        const finalTranscript = `${this.#snapshot.finalTranscript}${part.text}`;
        this.#setSnapshot({
          finalTranscript,
          interimTranscript: "",
          transcript: finalTranscript,
        });
        this.#emit({ type: "final", text: part.text });
        return false;
      }
      case "error": {
        this.#failRun(
          run,
          VoiceInputError.isInstance(part.error)
            ? part.error
            : this.#normalizeError(part.error, "provider-error"),
        );
        return true;
      }
      case "speech-start": {
        this.#emit({ type: "speech-start" });
        return false;
      }
      case "speech-end": {
        this.#emit({ type: "speech-end" });
        return false;
      }
    }
  }

  async #pumpAudio(
    run: ActiveRun,
    stream: ReadableStream<Int16Array>,
    session: VoiceInputProviderV1Session,
  ): Promise<void> {
    const reader = stream.getReader();

    try {
      while (this.#isActive(run)) {
        const result = await reader.read();

        if (result.done || !this.#isActive(run)) {
          break;
        }

        if (!(result.value instanceof Int16Array)) {
          throw new VoiceInputError({
            code: "audio-error",
            message: "The audio source emitted a non-PCM16 audio chunk.",
          });
        }

        await session.sendAudio(result.value);
      }
    } catch (error) {
      if (this.#isActive(run)) {
        this.#failRun(run, this.#normalizeError(error, "audio-error"));
      }
    } finally {
      reader.releaseLock();
    }
  }

  #scheduleDurationLimit(run: ActiveRun): void {
    const { maxDurationMs } = this.#configuration;
    const warningDelayMs = maxDurationMs - DURATION_WARNING_MS;
    const warn = (): void => {
      if (this.#isActive(run) && this.#snapshot.status === "listening") {
        this.#emit({
          type: "duration-warning",
          remainingMs: Math.min(DURATION_WARNING_MS, maxDurationMs),
          maxDurationMs,
        });
      }
    };

    if (warningDelayMs <= 0) {
      warn();
    } else {
      run.warningTimer = setTimeout(warn, warningDelayMs);
    }

    run.durationTimer = setTimeout(() => {
      if (this.#isActive(run) && this.#snapshot.status === "listening") {
        void this.stop("max-duration");
      }
    }, maxDurationMs);
  }

  #setPreflightError(error: VoiceInputError): void {
    this.#setSnapshot({
      transcript: "",
      interimTranscript: "",
      finalTranscript: "",
      error,
    });
    this.#transition("error");
    this.#emit({ type: "error", error });
  }

  #failRun(run: ActiveRun, error: VoiceInputError): void {
    if (!this.#isActive(run)) {
      return;
    }

    this.#activeRun = undefined;
    this.#abortRun(run, error);
    this.#textEngine?.cancel();
    this.#setSnapshot({
      transcript: this.#snapshot.finalTranscript,
      interimTranscript: "",
      error,
    });
    this.#transition("error");
    this.#emit({ type: "error", error });
  }

  #abortRun(run: ActiveRun, reason: unknown): void {
    this.#clearRunTimers(run);
    safely(() => run.abortController.abort(reason));
    safely(() => run.audio?.abort(reason));
    safely(() => run.providerSession?.abort(reason));
  }

  #normalizeValidationError(error: unknown): VoiceInputError {
    if (VoiceInputError.isInstance(error)) {
      return error;
    }

    return new VoiceInputError({
      code: "invalid-configuration",
      message: `The ${this.#provider.provider} provider could not validate the session options.`,
      provider: this.#provider.provider,
      cause: error,
    });
  }

  #normalizeError(
    error: unknown,
    code: Extract<VoiceInputErrorCode, "audio-error" | "provider-error">,
  ): VoiceInputError {
    if (VoiceInputError.isInstance(error)) {
      return error;
    }

    return new VoiceInputError({
      code,
      message:
        code === "audio-error"
          ? "The audio source failed."
          : `${this.#provider.provider} failed during the transcription session.`,
      ...(code === "provider-error"
        ? { provider: this.#provider.provider }
        : {}),
      retryable: true,
      cause: error,
    });
  }

  #isActive(run: ActiveRun): boolean {
    return this.#activeRun === run;
  }

  #isListening(run: ActiveRun): boolean {
    return this.#isActive(run) && this.#snapshot.status === "listening";
  }

  #transition(status: VoiceInputStatus): void {
    const previousStatus = this.#snapshot.status;

    if (previousStatus === status) {
      return;
    }

    this.#setSnapshot({ status });
    this.#emit({ type: "status-change", previousStatus, status });
  }

  #setSnapshot(patch: Partial<VoiceInputSnapshot>): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
  }

  #emit(event: VoiceInputSessionEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        reportUnhandledError(error);
      }
    }
  }

  #clearRunTimers(run: ActiveRun): void {
    if (run.warningTimer !== undefined) {
      clearTimeout(run.warningTimer);
      delete run.warningTimer;
    }
    if (run.durationTimer !== undefined) {
      clearTimeout(run.durationTimer);
      delete run.durationTimer;
    }
  }

  async #completeTextEngine(run: ActiveRun): Promise<boolean> {
    const completion = this.#textEngine?.complete();
    if (completion === undefined) {
      return this.#isActive(run);
    }

    if (completion.processing) {
      this.#transition("processing");
    }

    const errors = await completion.result;
    if (!this.#isActive(run)) {
      return false;
    }

    for (const error of errors) {
      this.#setSnapshot({ error });
      this.#emit({ type: "error", error });
    }
    return true;
  }
}

function getTranscriptionOptions(options: {
  language?: string | undefined;
  vocabulary?: readonly string[] | undefined;
  endpointing?: VoiceTranscriptionOptions["endpointing"] | undefined;
}): VoiceTranscriptionOptions {
  return {
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.vocabulary === undefined
      ? {}
      : { vocabulary: options.vocabulary }),
    ...(options.endpointing === undefined
      ? {}
      : { endpointing: options.endpointing }),
  };
}

function formatValidationIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "options" : issue.path.join(".");
  return `${path}: ${issue.message}`;
}

function isValidLanguage(language: string): boolean {
  if (language.length === 0 || language !== language.trim()) {
    return false;
  }

  try {
    return Intl.getCanonicalLocales(language).length === 1;
  } catch {
    return false;
  }
}

function assertProvider(provider: VoiceInputProviderV1): void {
  if (
    typeof provider !== "object" ||
    provider === null ||
    provider.specificationVersion !== "v1" ||
    typeof provider.provider !== "string" ||
    provider.provider.length === 0 ||
    typeof provider.modelId !== "string" ||
    provider.modelId.length === 0 ||
    !Number.isInteger(provider.sampleRate) ||
    provider.sampleRate <= 0 ||
    typeof provider.validateOptions !== "function" ||
    typeof provider.doOpen !== "function"
  ) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message:
        "provider must implement the VoiceInputProviderV1 specification.",
    });
  }
}

function assertAudioSource(audioSource: VoiceAudioSource): void {
  if (
    typeof audioSource !== "object" ||
    audioSource === null ||
    typeof audioSource.prepare !== "function"
  ) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message: "audioSource must implement the VoiceAudioSource interface.",
    });
  }
}

function assertTextEngine(textEngine: VoiceInputTextEngine): void {
  if (
    typeof textEngine !== "object" ||
    textEngine === null ||
    typeof textEngine.begin !== "function" ||
    typeof textEngine.applyInterim !== "function" ||
    typeof textEngine.applyFinal !== "function" ||
    typeof textEngine.complete !== "function" ||
    typeof textEngine.cancel !== "function"
  ) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message: "textEngine must implement the VoiceInputTextEngine interface.",
    });
  }
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    reportUnhandledError(error);
  }
}

function reportUnhandledError(error: unknown): void {
  const reportError = (
    globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    }
  ).reportError;

  if (typeof reportError === "function") {
    reportError(error);
  } else {
    queueMicrotask(() => {
      throw error;
    });
  }
}

async function withTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  provider: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new VoiceInputError({
              code: "provider-error",
              message: `${provider} did not finish the transcription session in time.`,
              provider,
              retryable: true,
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
