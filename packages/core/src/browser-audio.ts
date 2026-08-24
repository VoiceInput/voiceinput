import { VoiceInputError } from "@voiceinput/provider";

import {
  AUDIO_WORKLET_SOURCE,
  VOICE_INPUT_PROCESSOR_NAME,
} from "./audio-worklet-source.js";
import type {
  PreparedVoiceAudioSource,
  VoiceAudioSource,
  VoiceAudioSourcePrepareOptions,
} from "./session.js";

const DEFAULT_FRAME_DURATION_MS = 20;
const FLUSH_TIMEOUT_MS = 500;

export type BrowserVoiceInputCapability =
  | "secure-context"
  | "media-devices"
  | "get-user-media"
  | "audio-context"
  | "audio-worklet";

export interface BrowserVoiceInputSupport {
  readonly isSupported: boolean;
  readonly missingCapabilities: readonly BrowserVoiceInputCapability[];
}

export interface CreateBrowserAudioSourceOptions {
  /** Additional microphone constraints. VoiceInput always requests mono audio. */
  constraints?: MediaTrackConstraints;
  /** Duration of each emitted PCM16 frame. Defaults to 20 milliseconds. */
  frameDurationMs?: number;
}

export function getBrowserVoiceInputSupport(): BrowserVoiceInputSupport {
  const missingCapabilities: BrowserVoiceInputCapability[] = [];
  const browser = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };

  if (globalThis.isSecureContext !== true) {
    missingCapabilities.push("secure-context");
  }
  if (
    typeof navigator === "undefined" ||
    navigator.mediaDevices === undefined
  ) {
    missingCapabilities.push("media-devices");
  } else if (typeof navigator.mediaDevices.getUserMedia !== "function") {
    missingCapabilities.push("get-user-media");
  }
  if (
    browser.AudioContext === undefined &&
    browser.webkitAudioContext === undefined
  ) {
    missingCapabilities.push("audio-context");
  } else {
    const AudioContextConstructor =
      browser.AudioContext ?? browser.webkitAudioContext;
    if (
      AudioContextConstructor === undefined ||
      !("audioWorklet" in AudioContextConstructor.prototype) ||
      typeof globalThis.AudioWorkletNode !== "function"
    ) {
      missingCapabilities.push("audio-worklet");
    }
  }

  return Object.freeze({
    isSupported: missingCapabilities.length === 0,
    missingCapabilities: Object.freeze(missingCapabilities),
  });
}

export function createBrowserAudioSource(
  options: CreateBrowserAudioSourceOptions = {},
): VoiceAudioSource {
  const frameDurationMs = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
  if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
    throw new VoiceInputError({
      code: "invalid-configuration",
      message: "frameDurationMs must be a positive finite number.",
    });
  }

  return {
    async prepare(prepareOptions) {
      assertBrowserSupport();
      assertUserActivation();
      return prepareBrowserAudio(prepareOptions, {
        constraints: options.constraints,
        frameDurationMs,
      });
    },
  };
}

async function prepareBrowserAudio(
  prepareOptions: VoiceAudioSourcePrepareOptions,
  options: {
    constraints: MediaTrackConstraints | undefined;
    frameDurationMs: number;
  },
): Promise<PreparedVoiceAudioSource> {
  const { abortSignal, sampleRate } = prepareOptions;
  throwIfAborted(abortSignal);

  let mediaStream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  let sourceNode: MediaStreamAudioSourceNode | undefined;
  let workletNode: AudioWorkletNode | undefined;
  let silentOutput: GainNode | undefined;
  let streamController: ReadableStreamDefaultController<Int16Array> | undefined;
  let closeContextPromise: Promise<void> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveFlush: (() => void) | undefined;
  let started = false;
  let closed = false;

  const stream = new ReadableStream<Int16Array>({
    start(controller) {
      streamController = controller;
    },
  });

  const cleanup = (error?: unknown): void => {
    if (closed) {
      return;
    }
    closed = true;
    abortSignal.removeEventListener("abort", handleAbort);
    safely(() => sourceNode?.disconnect());
    safely(() => workletNode?.disconnect());
    safely(() => silentOutput?.disconnect());
    safely(() => workletNode?.port.close());
    for (const track of mediaStream?.getTracks() ?? []) {
      safely(() => track.stop());
    }
    if (audioContext !== undefined && audioContext.state !== "closed") {
      closeContextPromise ??= audioContext.close().catch(() => {});
    }
    if (streamController !== undefined) {
      if (error === undefined) {
        safely(() => streamController?.close());
      } else {
        safely(() => streamController?.error(error));
      }
    }
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    resolveFlush?.();
    resolveFlush = undefined;
  };

  const handleAbort = (): void => cleanup();
  abortSignal.addEventListener("abort", handleAbort, { once: true });

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...options.constraints,
        channelCount: 1,
      },
      video: false,
    });
    if (closed || abortSignal.aborted) {
      stopMediaStream(mediaStream);
    }
    throwIfAborted(abortSignal);

    const AudioContextConstructor = getAudioContextConstructor();
    audioContext = createAudioContext(AudioContextConstructor, sampleRate);
    if (audioContext.audioWorklet === undefined) {
      throw unsupportedBrowser(["audio-worklet"]);
    }

    await loadWorklet(audioContext);
    throwIfAborted(abortSignal);

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(
      audioContext,
      VOICE_INPUT_PROCESSOR_NAME,
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: {
          frameSamples: Math.max(
            1,
            Math.round((sampleRate * options.frameDurationMs) / 1_000),
          ),
          targetSampleRate: sampleRate,
        },
      },
    );
    silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    workletNode.connect(silentOutput);
    silentOutput.connect(audioContext.destination);

    workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
      if (closed || streamController === undefined) {
        return;
      }
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        streamController.enqueue(new Int16Array(data));
      } else if (data instanceof Int16Array) {
        streamController.enqueue(data);
      } else if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        data.type === "flushed"
      ) {
        resolveFlush?.();
        resolveFlush = undefined;
      }
    };
    workletNode.port.onmessageerror = (event) => {
      cleanup(
        new VoiceInputError({
          code: "audio-error",
          message: "The browser could not read microphone audio frames.",
          retryable: true,
          cause: event,
        }),
      );
    };
    workletNode.addEventListener(
      "processorerror",
      (event) => {
        cleanup(
          new VoiceInputError({
            code: "audio-error",
            message: "The microphone audio processor stopped unexpectedly.",
            retryable: true,
            cause: event,
          }),
        );
      },
      { once: true },
    );

    for (const track of mediaStream.getAudioTracks()) {
      track.addEventListener(
        "ended",
        () => {
          if (!closed) {
            cleanup(
              new VoiceInputError({
                code: "audio-error",
                message: "The microphone stopped unexpectedly.",
                retryable: true,
              }),
            );
          }
        },
        { once: true },
      );
    }

    // Safari commonly creates a suspended context. Resume it while the original
    // activation is still available; audio frames do not flow until start().
    if (audioContext.state !== "running") {
      await audioContext.resume();
    }
    throwIfAborted(abortSignal);

    return {
      stream,
      start() {
        if (closed || started) {
          return;
        }
        started = true;
        sourceNode?.connect(workletNode as AudioWorkletNode);
      },
      async stop() {
        if (!closed && started && workletNode !== undefined) {
          safely(() => sourceNode?.disconnect());
          started = false;
          await new Promise<void>((resolve) => {
            resolveFlush = resolve;
            flushTimer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
            workletNode?.port.postMessage({ type: "flush" });
          });
        }
        cleanup();
        await closeContextPromise;
      },
      abort() {
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    if (VoiceInputError.isInstance(error)) {
      throw error;
    }
    throw normalizeBrowserAudioError(error);
  }
}

export function normalizeBrowserAudioError(error: unknown): VoiceInputError {
  const name = getErrorName(error);

  if (name === "NotAllowedError" || name === "SecurityError") {
    return new VoiceInputError({
      code: "permission-denied",
      message: "Microphone permission was denied.",
      cause: error,
    });
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new VoiceInputError({
      code: "device-not-found",
      message: "No microphone is available.",
      cause: error,
    });
  }
  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError"
  ) {
    return new VoiceInputError({
      code: "device-busy",
      message:
        "The microphone is unavailable or in use by another application.",
      retryable: true,
      cause: error,
    });
  }

  return new VoiceInputError({
    code: "audio-error",
    message: "The browser audio pipeline failed.",
    retryable: true,
    cause: error,
  });
}

function assertBrowserSupport(): void {
  const support = getBrowserVoiceInputSupport();
  if (!support.isSupported) {
    throw unsupportedBrowser(support.missingCapabilities);
  }
}

function assertUserActivation(): void {
  if (
    navigator.userActivation !== undefined &&
    navigator.userActivation.isActive === false
  ) {
    throw new VoiceInputError({
      code: "permission-denied",
      message:
        "Microphone access must be started directly from a user interaction.",
    });
  }
}

function unsupportedBrowser(
  missingCapabilities: readonly BrowserVoiceInputCapability[],
): VoiceInputError {
  return new VoiceInputError({
    code: "unsupported-browser",
    message: `Voice input is unavailable because the browser is missing: ${missingCapabilities.join(
      ", ",
    )}.`,
  });
}

function getAudioContextConstructor(): typeof AudioContext {
  const browser = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor =
    browser.AudioContext ?? browser.webkitAudioContext;
  if (AudioContextConstructor === undefined) {
    throw unsupportedBrowser(["audio-context"]);
  }
  return AudioContextConstructor;
}

function createAudioContext(
  AudioContextConstructor: typeof AudioContext,
  sampleRate: number,
): AudioContext {
  try {
    return new AudioContextConstructor({
      latencyHint: "interactive",
      sampleRate,
    });
  } catch (error) {
    const name = getErrorName(error);
    if (name !== "NotSupportedError" && name !== "TypeError") {
      throw error;
    }
    return new AudioContextConstructor({ latencyHint: "interactive" });
  }
}

async function loadWorklet(context: AudioContext): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([AUDIO_WORKLET_SOURCE], { type: "text/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (
      signal.reason ??
      new DOMException("The operation was aborted.", "AbortError")
    );
  }
}

function getErrorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : undefined;
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Cleanup is best effort and remains idempotent.
  }
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    safely(() => track.stop());
  }
}
