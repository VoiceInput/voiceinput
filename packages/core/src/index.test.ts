import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceInputProviderV1Session,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";
import {
  createFakeVoiceInputProvider,
  type FakeVoiceInputProvider,
} from "@voiceinput/provider/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVoiceInputSession,
  type PreparedVoiceAudioSource,
  type VoiceAudioSource,
  type VoiceAudioSourcePrepareOptions,
  type VoiceInputSession,
  type VoiceInputSessionEvent,
  type VoiceInputTextCompletion,
  type VoiceInputTextEngine,
} from "./index.js";

interface AudioInspection {
  prepareOptions: VoiceAudioSourcePrepareOptions;
  streamController: ReadableStreamDefaultController<Int16Array>;
  startCallCount: number;
  stopCallCount: number;
  abortCallCount: number;
  closed: boolean;
  prepared: PreparedVoiceAudioSource;
  resolvePrepare: (prepared: PreparedVoiceAudioSource) => void;
  rejectPrepare: (error: unknown) => void;
  resolveStart: () => void;
  resolveStop: () => void;
}

interface FakeAudioSource {
  audioSource: VoiceAudioSource;
  sessions: AudioInspection[];
  prepareCallCount: number;
  resolvePrepare(index?: number): void;
  rejectPrepare(error: unknown, index?: number): void;
  resolveStart(index?: number): void;
  resolveStop(index?: number): void;
  emitChunk(chunk: Int16Array, index?: number): void;
  emitInvalidChunk(index?: number): void;
}

function createFakeAudioSource(
  options: {
    autoPrepare?: boolean;
    autoStart?: boolean;
    autoStop?: boolean;
    startError?: unknown;
    stopError?: unknown;
  } = {},
): FakeAudioSource {
  const sessions: AudioInspection[] = [];
  const autoPrepare = options.autoPrepare ?? true;
  const autoStart = options.autoStart ?? true;
  const autoStop = options.autoStop ?? true;

  const getSession = (index = sessions.length - 1): AudioInspection => {
    const session = sessions[index];
    if (session === undefined) {
      throw new Error(`Audio session ${index} does not exist.`);
    }
    return session;
  };

  const close = (session: AudioInspection): void => {
    if (!session.closed) {
      session.closed = true;
      session.streamController.close();
    }
  };

  const fake: FakeAudioSource = {
    sessions,
    prepareCallCount: 0,
    audioSource: {
      prepare(prepareOptions) {
        fake.prepareCallCount += 1;
        let streamController:
          ReadableStreamDefaultController<Int16Array> | undefined;
        const stream = new ReadableStream<Int16Array>({
          start(controller) {
            streamController = controller;
          },
        });

        if (streamController === undefined) {
          throw new Error("Audio stream did not initialize.");
        }

        let resolvePrepare: (
          prepared: PreparedVoiceAudioSource,
        ) => void = () => {};
        let rejectPrepare: (error: unknown) => void = () => {};
        const preparePromise = new Promise<PreparedVoiceAudioSource>(
          (resolve, reject) => {
            resolvePrepare = resolve;
            rejectPrepare = reject;
          },
        );
        let resolveStop: () => void = () => {};
        const stopPromise = new Promise<void>((resolve) => {
          resolveStop = resolve;
        });
        let resolveStart: () => void = () => {};
        const startPromise = new Promise<void>((resolve) => {
          resolveStart = resolve;
        });
        const inspection: AudioInspection = {
          prepareOptions,
          streamController,
          startCallCount: 0,
          stopCallCount: 0,
          abortCallCount: 0,
          closed: false,
          prepared: undefined as unknown as PreparedVoiceAudioSource,
          resolvePrepare,
          rejectPrepare,
          resolveStart,
          resolveStop,
        };
        const prepared: PreparedVoiceAudioSource = {
          stream,
          async start() {
            inspection.startCallCount += 1;
            if (options.startError !== undefined) {
              throw options.startError;
            }
            if (!autoStart) {
              await startPromise;
            }
          },
          async stop() {
            inspection.stopCallCount += 1;
            if (options.stopError !== undefined) {
              throw options.stopError;
            }
            if (!autoStop) {
              await stopPromise;
            }
            close(inspection);
          },
          abort() {
            if (inspection.abortCallCount === 0) {
              inspection.abortCallCount += 1;
              close(inspection);
            }
          },
        };
        inspection.prepared = prepared;
        sessions.push(inspection);

        if (autoPrepare) {
          resolvePrepare(prepared);
        }

        return preparePromise;
      },
    },
    resolvePrepare(index) {
      const session = getSession(index);
      session.resolvePrepare(session.prepared);
    },
    rejectPrepare(error, index) {
      getSession(index).rejectPrepare(error);
    },
    resolveStart(index) {
      getSession(index).resolveStart();
    },
    resolveStop(index) {
      getSession(index).resolveStop();
    },
    emitChunk(chunk, index) {
      getSession(index).streamController.enqueue(chunk);
    },
    emitInvalidChunk(index) {
      getSession(index).streamController.enqueue(
        new Uint8Array([1, 2]) as unknown as Int16Array,
      );
    },
  };

  return fake;
}

function createSession(
  options: {
    provider?: FakeVoiceInputProvider;
    audio?: FakeAudioSource;
    maxDurationMs?: number;
    connectionTimeoutMs?: number;
    language?: string;
    vocabulary?: readonly string[];
    textEngine?: VoiceInputTextEngine;
  } = {},
): {
  session: VoiceInputSession;
  provider: FakeVoiceInputProvider;
  audio: FakeAudioSource;
  events: VoiceInputSessionEvent[];
} {
  const provider = options.provider ?? createFakeVoiceInputProvider();
  const audio = options.audio ?? createFakeAudioSource();
  const session = createVoiceInputSession({
    provider: provider.provider,
    audioSource: audio.audioSource,
    ...(options.maxDurationMs === undefined
      ? {}
      : { maxDurationMs: options.maxDurationMs }),
    ...(options.connectionTimeoutMs === undefined
      ? {}
      : { connectionTimeoutMs: options.connectionTimeoutMs }),
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.vocabulary === undefined
      ? {}
      : { vocabulary: options.vocabulary }),
    ...(options.textEngine === undefined
      ? {}
      : { textEngine: options.textEngine }),
  });
  const events: VoiceInputSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return { session, provider, audio, events };
}

function createFakeTextEngine(
  completion: VoiceInputTextCompletion = {
    processing: false,
    result: Promise.resolve([]),
  },
): VoiceInputTextEngine & {
  begin: ReturnType<typeof vi.fn<() => void>>;
  applyInterim: ReturnType<typeof vi.fn<(text: string) => void>>;
  applyFinal: ReturnType<typeof vi.fn<(text: string) => void>>;
  complete: ReturnType<typeof vi.fn<() => VoiceInputTextCompletion>>;
  cancel: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    getSnapshot: () => ({
      value: "",
      selection: null,
      interimTranscript: "",
      spans: [],
    }),
    setTarget: () => {},
    captureSelection: () => null,
    reconcileControlledValue: () => {},
    begin: vi.fn<() => void>(),
    applyInterim: vi.fn<(text: string) => void>(),
    applyFinal: vi.fn<(text: string) => void>(),
    complete: vi.fn<() => VoiceInputTextCompletion>(() => completion),
    cancel: vi.fn<() => void>(),
    updateOptions: () => {},
    undo: () => {},
    redo: () => {},
    isWritable: () => true,
    subscribe: () => () => {},
    destroy: () => {},
  };
}

async function waitFor(assertion: () => void, timeout = 1_000): Promise<void> {
  await vi.waitFor(assertion, { timeout, interval: 1 });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it.each([
    ["language", { language: "en_US" }, /language:.*BCP 47/],
    ["vocabulary shape", { vocabulary: "VoiceInput" }, /vocabulary:.*array/],
    [
      "vocabulary terms",
      { vocabulary: ["", " padded ", 42] },
      /vocabulary\.0:.*; vocabulary\.1:.*; vocabulary\.2:/,
    ],
    ["endpointing shape", { endpointing: null }, /endpointing:.*silenceMs/],
    [
      "endpointing extra keys",
      { endpointing: { silenceMs: 500, extra: true } },
      /endpointing:.*only silenceMs/,
    ],
    [
      "endpointing duration",
      { endpointing: { silenceMs: 1.5 } },
      /endpointing\.silenceMs:.*safe integer/,
    ],
    [
      "unsafe endpointing duration",
      { endpointing: { silenceMs: Number.MAX_SAFE_INTEGER + 1 } },
      /endpointing\.silenceMs:.*safe integer/,
    ],
    ["maximum duration", { maxDurationMs: 0 }, /maxDurationMs/],
    [
      "unsafe maximum duration",
      { maxDurationMs: Number.MAX_SAFE_INTEGER + 1 },
      /maxDurationMs:.*safe integer/,
    ],
    [
      "connection timeout",
      { connectionTimeoutMs: Number.POSITIVE_INFINITY },
      /connectionTimeoutMs/,
    ],
  ])("rejects invalid %s configuration", (_name, configuration, message) => {
    const provider = createFakeVoiceInputProvider();
    const audio = createFakeAudioSource();
    let thrown: unknown;

    try {
      createVoiceInputSession({
        provider: provider.provider,
        audioSource: audio.audioSource,
        ...configuration,
      } as Parameters<typeof createVoiceInputSession>[0]);
    } catch (error) {
      thrown = error;
    }

    expect(VoiceInputError.isInstance(thrown)).toBe(true);
    if (!VoiceInputError.isInstance(thrown)) {
      return;
    }
    expect(thrown.code).toBe("invalid-configuration");
    expect(thrown.message).toMatch(message);
    expect(thrown.cause).toBeInstanceOf(TypeError);
  });

  it("rejects inherited endpointing keys", () => {
    const provider = createFakeVoiceInputProvider();
    const audio = createFakeAudioSource();
    const prototype = Object.defineProperty({}, "extra", {
      enumerable: true,
      value: true,
    });
    const endpointing = Object.assign(Object.create(prototype) as object, {
      silenceMs: 500,
    });

    expect(() =>
      createVoiceInputSession({
        provider: provider.provider,
        audioSource: audio.audioSource,
        endpointing,
      } as Parameters<typeof createVoiceInputSession>[0]),
    ).toThrow(/endpointing:.*only silenceMs/);
  });

  it("normalizes getter-backed options exactly once", async () => {
    const validateOptions =
      vi.fn<(options: VoiceTranscriptionOptions) => void>();
    const provider = createFakeVoiceInputProvider({ validateOptions });
    const audio = createFakeAudioSource();
    const reads = {
      language: 0,
      vocabulary: 0,
      term: 0,
      endpointing: 0,
      silenceMs: 0,
      maxDurationMs: 0,
      connectionTimeoutMs: 0,
    };
    const vocabulary = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => (++reads.term === 1 ? "VoiceInput" : " changed "),
    }) as string[];
    const endpointing = {
      get silenceMs() {
        return ++reads.silenceMs === 1 ? 500 : -1;
      },
    };
    const options = {
      provider: provider.provider,
      audioSource: audio.audioSource,
      get language() {
        return ++reads.language === 1 ? "en-CA" : "en_US";
      },
      get vocabulary() {
        ++reads.vocabulary;
        return vocabulary;
      },
      get endpointing() {
        ++reads.endpointing;
        return endpointing;
      },
      get maxDurationMs() {
        return ++reads.maxDurationMs === 1 ? 60_000 : -1;
      },
      get connectionTimeoutMs() {
        return ++reads.connectionTimeoutMs === 1 ? 5_000 : -1;
      },
    };

    const session = createVoiceInputSession(options);
    await session.start();

    expect(reads).toEqual({
      language: 1,
      vocabulary: 1,
      term: 1,
      endpointing: 1,
      silenceMs: 1,
      maxDurationMs: 1,
      connectionTimeoutMs: 1,
    });
    expect(validateOptions).toHaveBeenCalledWith({
      language: "en-CA",
      vocabulary: ["VoiceInput"],
      endpointing: { silenceMs: 500 },
    });
    await session.cancel();
  });

  it("copies mutable session options before provider validation", async () => {
    const validateOptions =
      vi.fn<(options: VoiceTranscriptionOptions) => void>();
    const provider = createFakeVoiceInputProvider({ validateOptions });
    const audio = createFakeAudioSource();
    const vocabulary = ["VoiceInput"];
    const endpointing = { silenceMs: 500 };
    const session = createVoiceInputSession({
      provider: provider.provider,
      audioSource: audio.audioSource,
      vocabulary,
      endpointing,
    });

    vocabulary[0] = "changed";
    endpointing.silenceMs = 1;
    await session.start();

    expect(validateOptions).toHaveBeenCalledWith({
      vocabulary: ["VoiceInput"],
      endpointing: { silenceMs: 500 },
    });
    expect(Object.isFrozen(validateOptions.mock.calls[0]?.[0].vocabulary)).toBe(
      true,
    );
  });

  it("runs provider validation before preparing audio", async () => {
    const validationError = new VoiceInputError({
      code: "unsupported-feature",
      message: "Vocabulary is unavailable.",
      provider: "fake",
    });
    const validateOptions = vi.fn<(options: VoiceTranscriptionOptions) => void>(
      () => {
        throw validationError;
      },
    );
    const provider = createFakeVoiceInputProvider({ validateOptions });
    const audio = createFakeAudioSource();
    const { session } = createSession({
      provider,
      audio,
      language: "en-CA",
      vocabulary: ["VoiceInput"],
    });

    await expect(session.start()).resolves.toBeUndefined();
    expect(validateOptions).toHaveBeenCalledWith({
      language: "en-CA",
      vocabulary: ["VoiceInput"],
    });
    expect(session.getSnapshot().error).toBe(validationError);
    expect(audio.prepareCallCount).toBe(0);
  });
});

describe("session lifecycle", () => {
  it("runs the normal state sequence and accumulates transcripts", async () => {
    const { session, provider, audio, events } = createSession();

    await session.start();
    expect(session.getSnapshot().status).toBe("listening");
    expect(audio.sessions[0]?.prepareOptions.sampleRate).toBe(16_000);
    expect(audio.sessions[0]?.startCallCount).toBe(1);

    provider.controller.emit({ type: "interim", text: "hel" });
    provider.controller.emit({ type: "interim", text: "hello" });
    provider.controller.emit({ type: "final", text: "hello" });
    provider.controller.emit({ type: "final", text: "world" });
    provider.controller.emit({ type: "speech-start" });
    provider.controller.emit({ type: "speech-end" });
    await waitFor(() => {
      expect(session.getSnapshot().finalTranscript).toBe("hello world");
    });

    audio.emitChunk(new Int16Array([1, 2]));
    audio.emitChunk(new Int16Array([3, 4]));
    await waitFor(() => {
      expect(provider.controller.sessions[0]?.audioChunks).toHaveLength(2);
    });
    await session.stop();

    expect(events).toContainEqual({ type: "speech-start" });
    expect(events).toContainEqual({ type: "speech-end" });

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      transcript: "hello world",
      interimTranscript: "",
      finalTranscript: "hello world",
      error: null,
    });
    expect(
      events
        .filter((event) => event.type === "status-change")
        .map((event) => (event.type === "status-change" ? event.status : "")),
    ).toEqual([
      "requesting-permission",
      "connecting",
      "listening",
      "stopping",
      "idle",
    ]);
    expect(events).toContainEqual({ type: "stop", reason: "user" });
  });

  it("uses one boundary policy for interim and cumulative final state", async () => {
    const { session, provider } = createSession();

    await session.start();
    provider.controller.emit({ type: "final", text: "  hello  " });
    provider.controller.emit({ type: "final", text: "world" });
    provider.controller.emit({ type: "final", text: "," });
    provider.controller.emit({ type: "final", text: "again" });
    provider.controller.emit({ type: "final", text: "" });
    provider.controller.emit({ type: "final", text: "今" });
    provider.controller.emit({ type: "final", text: "天" });
    provider.controller.emit({ type: "interim", text: "  晴れ  " });

    await waitFor(() => {
      expect(session.getSnapshot()).toMatchObject({
        finalTranscript: "hello world, again 今天",
        interimTranscript: "  晴れ  ",
        transcript: "hello world, again 今天晴れ",
      });
    });
  });

  it("cancels immediately while preserving finals and discarding interim", async () => {
    const { session, provider, audio, events } = createSession();
    await session.start();
    provider.controller.emit({ type: "final", text: "kept" });
    provider.controller.emit({ type: "interim", text: " discarded" });
    await waitFor(() => {
      expect(session.getSnapshot().interimTranscript).toBe(" discarded");
    });

    await session.cancel();
    await session.cancel();

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      transcript: "kept",
      interimTranscript: "",
      finalTranscript: "kept",
    });
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
    expect(provider.controller.sessions[0]?.abortCallCount).toBe(1);
    expect(events.filter((event) => event.type === "cancel")).toHaveLength(1);
  });

  it("invalidates late audio preparation after cancellation", async () => {
    const audio = createFakeAudioSource({ autoPrepare: false });
    const { session } = createSession({ audio });
    const startPromise = session.start();
    expect(session.getSnapshot().status).toBe("requesting-permission");

    await session.cancel();
    audio.resolvePrepare();
    await startPromise;

    expect(session.getSnapshot().status).toBe("idle");
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
  });

  it("aborts a provider connection that is still opening", async () => {
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const { session, audio } = createSession({ provider });
    const startPromise = session.start();
    await provider.controller.waitForSession();
    expect(session.getSnapshot().status).toBe("connecting");

    await session.cancel();
    await expect(startPromise).resolves.toBeUndefined();

    expect(session.getSnapshot().status).toBe("idle");
    expect(provider.controller.sessions[0]).toMatchObject({
      aborted: true,
      abortCallCount: 1,
    });
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
  });

  it("stops cleanly while permission is pending", async () => {
    const audio = createFakeAudioSource({ autoPrepare: false });
    const { session, events } = createSession({ audio });
    const startPromise = session.start();

    await session.stop();
    audio.resolvePrepare();
    await startPromise;

    expect(session.getSnapshot().status).toBe("idle");
    expect(events).toContainEqual({ type: "stop", reason: "user" });
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
  });

  it("isolates an old delayed stop from a restarted session", async () => {
    const audio = createFakeAudioSource({ autoStop: false });
    const { session } = createSession({ audio });
    await session.start();

    const oldStop = session.stop();
    await session.cancel();
    await session.start();
    const newStop = session.stop();

    audio.resolveStop(0);
    await oldStop;
    expect(session.getSnapshot().status).toBe("stopping");

    audio.resolveStop(1);
    await newStop;
    expect(session.getSnapshot().status).toBe("idle");
    expect(audio.sessions[0]?.stopCallCount).toBe(1);
    expect(audio.sessions[1]?.stopCallCount).toBe(1);
  });

  it("ignores active starts and supports toggle", async () => {
    const { session, audio } = createSession();
    await Promise.all([session.start(), session.start()]);
    expect(audio.prepareCallCount).toBe(1);

    await session.toggle();
    expect(session.getSnapshot().status).toBe("idle");
    await session.toggle();
    expect(session.getSnapshot().status).toBe("listening");
    await session.cancel();
  });

  it("normalizes audio preparation and startup failures", async () => {
    const pendingAudio = createFakeAudioSource({ autoPrepare: false });
    const first = createSession({ audio: pendingAudio });
    const firstStart = first.session.start();
    pendingAudio.rejectPrepare(new Error("device exploded"));
    await expect(firstStart).resolves.toBeUndefined();
    expect(first.session.getSnapshot().error?.code).toBe("audio-error");

    const startErrorAudio = createFakeAudioSource({
      startError: new Error("worklet failed"),
    });
    const second = createSession({ audio: startErrorAudio });
    await expect(second.session.start()).resolves.toBeUndefined();
    expect(second.session.getSnapshot().error?.code).toBe("audio-error");
  });

  it("preserves finalized text when the provider fails", async () => {
    const { session, provider } = createSession();
    await session.start();
    provider.controller.emit({ type: "final", text: "safe" });
    provider.controller.emit({ type: "interim", text: " unsafe" });
    await waitFor(() => {
      expect(session.getSnapshot().interimTranscript).toBe(" unsafe");
    });
    provider.controller.fail(
      new VoiceInputError({
        code: "network-error",
        message: "Offline.",
        retryable: true,
      }),
    );

    await waitFor(() => {
      expect(session.getSnapshot().status).toBe("error");
    });
    expect(session.getSnapshot()).toMatchObject({
      transcript: "safe",
      interimTranscript: "",
      finalTranscript: "safe",
    });
  });

  it("treats unexpected stream completion as a provider error", async () => {
    const { session, provider } = createSession();
    await session.start();

    provider.controller.close();

    await waitFor(() => {
      expect(session.getSnapshot().status).toBe("error");
    });
    expect(session.getSnapshot().error?.code).toBe("provider-error");
  });

  it("can restart cleanly after an error", async () => {
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const { session } = createSession({ provider });
    const firstStart = session.start();
    await provider.controller.waitForSession(0);
    provider.controller.rejectOpen(new Error("connection failed"), 0);
    await firstStart;
    expect(session.getSnapshot().status).toBe("error");

    const secondStart = session.start();
    await provider.controller.waitForSession(1);
    provider.controller.resolveOpen(1);
    await secondStart;

    expect(session.getSnapshot()).toMatchObject({
      status: "listening",
      transcript: "",
      error: null,
    });
    await session.cancel();
  });

  it("turns invalid audio chunks into non-throwing errors", async () => {
    const { session, audio } = createSession();
    await session.start();
    audio.emitInvalidChunk();

    await waitFor(() => {
      expect(session.getSnapshot().status).toBe("error");
    });
    expect(session.getSnapshot().error?.code).toBe("audio-error");
  });

  it("isolates subscriber exceptions from lifecycle state", async () => {
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal("reportError", reportError);
    const { session } = createSession();
    session.subscribe(() => {
      throw new Error("consumer callback failed");
    });

    await expect(session.start()).resolves.toBeUndefined();

    expect(session.getSnapshot().status).toBe("listening");
    expect(reportError).toHaveBeenCalled();
    await session.cancel();
  });
});

describe("connection deadline", () => {
  it("cannot be rearmed by a late acquisition callback", async () => {
    vi.useFakeTimers();
    const audio = createFakeAudioSource();
    const { session } = createSession({
      audio,
      connectionTimeoutMs: 100,
    });

    await session.start();
    audio.sessions[0]?.prepareOptions.onAcquired?.();
    await vi.advanceTimersByTimeAsync(100);

    expect(session.getSnapshot().status).toBe("listening");
    await session.cancel();
  });

  it("starts when audio is acquired during pending preparation", async () => {
    vi.useFakeTimers();
    const audio = createFakeAudioSource({ autoPrepare: false });
    const { session } = createSession({
      audio,
      connectionTimeoutMs: 100,
    });

    const start = session.start();
    audio.sessions[0]?.prepareOptions.onAcquired?.();
    await vi.advanceTimersByTimeAsync(100);
    await start;

    expect(session.getSnapshot().error?.code).toBe("network-error");
    expect(audio.sessions[0]?.prepareOptions.abortSignal.aborted).toBe(true);
    audio.resolvePrepare();
    await Promise.resolve();
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
  });

  it("bounds a token request that ignores cancellation", async () => {
    vi.useFakeTimers();
    const fake = createFakeVoiceInputProvider();
    let signal: AbortSignal | undefined;
    const provider: VoiceInputProviderV1 = {
      ...fake.provider,
      doOpen(options) {
        signal = options.abortSignal;
        return new Promise<VoiceInputProviderV1Session>(() => {});
      },
    };
    const audio = createFakeAudioSource();
    const session = createVoiceInputSession({
      provider,
      audioSource: audio.audioSource,
      connectionTimeoutMs: 1_000,
    });

    const start = session.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(session.getSnapshot().status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);
    await start;

    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: {
        code: "network-error",
        provider: "fake",
        retryable: true,
      },
    });
    expect(signal?.aborted).toBe(true);
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
  });

  it("aborts a socket that never opens", async () => {
    vi.useFakeTimers();
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const { session, audio } = createSession({
      provider,
      connectionTimeoutMs: 250,
    });

    const start = session.start();
    await provider.controller.waitForSession();
    await vi.advanceTimersByTimeAsync(250);
    await start;

    expect(provider.controller.sessions[0]).toMatchObject({
      aborted: true,
      abortCallCount: 1,
    });
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
    expect(session.getSnapshot().error?.code).toBe("network-error");
  });

  it("uses one deadline across provider opening and audio activation", async () => {
    vi.useFakeTimers();
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const audio = createFakeAudioSource({ autoStart: false });
    const { session } = createSession({
      provider,
      audio,
      connectionTimeoutMs: 100,
    });

    const start = session.start();
    await vi.advanceTimersByTimeAsync(90);
    audio.resolveStart();
    await provider.controller.waitForSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.sessions[0]?.startCallCount).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    await start;

    expect(session.getSnapshot().error?.code).toBe("network-error");
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
    expect(provider.controller.sessions[0]?.abortCallCount).toBe(1);
  });

  it("aborts a late session and retries successfully", async () => {
    vi.useFakeTimers();
    const retryProvider = createFakeVoiceInputProvider();
    let resolveLate: (session: VoiceInputProviderV1Session) => void = () => {};
    const lateSession = createAbortOnlyProviderSession();
    let openCount = 0;
    const provider: VoiceInputProviderV1 = {
      ...retryProvider.provider,
      doOpen(options) {
        openCount += 1;
        if (openCount === 1) {
          return new Promise<VoiceInputProviderV1Session>((resolve) => {
            resolveLate = resolve;
          });
        }
        return retryProvider.provider.doOpen(options);
      },
    };
    const audio = createFakeAudioSource();
    const session = createVoiceInputSession({
      provider,
      audioSource: audio.audioSource,
      connectionTimeoutMs: 100,
    });

    const firstStart = session.start();
    await vi.advanceTimersByTimeAsync(100);
    await firstStart;
    resolveLate(lateSession.session);
    await Promise.resolve();
    expect(lateSession.abort).toHaveBeenCalledOnce();

    await session.start();
    expect(session.getSnapshot().status).toBe("listening");
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
    expect(audio.sessions[1]?.startCallCount).toBe(1);
    await session.cancel();
  });
});

describe("graceful finalization", () => {
  it("accepts late finals before stream completion", async () => {
    const provider = createFakeVoiceInputProvider({
      autoCloseOnFinish: false,
    });
    const { session } = createSession({ provider });
    await session.start();

    const stopPromise = session.stop();
    await waitFor(() => {
      expect(provider.controller.sessions[0]?.finishCallCount).toBe(1);
    });
    provider.controller.emit({ type: "final", text: "late final" });
    provider.controller.close();
    await stopPromise;

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      transcript: "late final",
      finalTranscript: "late final",
    });
  });

  it("fails safely when the provider does not finish in time", async () => {
    vi.useFakeTimers();
    const provider = createFakeVoiceInputProvider({
      autoCloseOnFinish: false,
    });
    const { session } = createSession({ provider });
    await session.start();

    const stopPromise = session.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopPromise;

    expect(session.getSnapshot().status).toBe("error");
    expect(session.getSnapshot().error?.code).toBe("provider-error");
  });

  it("bounds shutdown when sending the last audio frame stalls", async () => {
    vi.useFakeTimers();
    const fake = createFakeVoiceInputProvider();
    const sendAudio = vi.fn<() => Promise<void>>(
      () => new Promise<void>(() => {}),
    );
    const provider = overrideProviderSession(fake, { sendAudio });
    const audio = createFakeAudioSource();
    const session = createVoiceInputSession({
      provider,
      audioSource: audio.audioSource,
    });
    await session.start();
    audio.emitChunk(new Int16Array([1, 2]));
    await waitFor(() => expect(sendAudio).toHaveBeenCalledOnce());

    const stop = session.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stop;

    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "provider-error" },
    });
  });

  it("bounds shutdown when the provider finish call stalls", async () => {
    vi.useFakeTimers();
    const fake = createFakeVoiceInputProvider();
    const finish = vi.fn<() => Promise<void>>(
      () => new Promise<void>(() => {}),
    );
    const provider = overrideProviderSession(fake, { finish });
    const audio = createFakeAudioSource();
    const session = createVoiceInputSession({
      provider,
      audioSource: audio.audioSource,
    });
    await session.start();

    const stop = session.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stop;

    expect(finish).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "provider-error" },
    });
  });
});

function overrideProviderSession(
  fake: FakeVoiceInputProvider,
  overrides: Partial<{
    sendAudio(chunk: Int16Array): PromiseLike<void> | void;
    finish(): PromiseLike<void> | void;
  }>,
): VoiceInputProviderV1 {
  return {
    ...fake.provider,
    async doOpen(options) {
      const session = await fake.provider.doOpen(options);
      return { ...session, ...overrides };
    },
  };
}

function createAbortOnlyProviderSession(): {
  session: VoiceInputProviderV1Session;
  abort: ReturnType<typeof vi.fn<(reason?: unknown) => void>>;
} {
  const abort = vi.fn<(reason?: unknown) => void>();
  return {
    abort,
    session: {
      stream: new ReadableStream<never>(),
      sendAudio() {},
      finish() {},
      abort,
    },
  };
}

describe("text engine integration", () => {
  it("forwards transcripts and waits in processing before emitting stop", async () => {
    let resolveCompletion: (
      errors: readonly VoiceInputError[],
    ) => void = () => {};
    const result = new Promise<readonly VoiceInputError[]>((resolve) => {
      resolveCompletion = resolve;
    });
    const textEngine = createFakeTextEngine({ processing: true, result });
    const { session, provider, events } = createSession({ textEngine });
    await session.start();

    provider.controller.emit({ type: "interim", text: "hel" });
    provider.controller.emit({ type: "final", text: "hello" });
    await waitFor(() => {
      expect(textEngine.applyFinal).toHaveBeenCalledWith("hello", "fake:0");
    });

    const stopPromise = session.stop();
    await waitFor(() => {
      expect(session.getSnapshot().status).toBe("processing");
    });
    expect(textEngine.begin).toHaveBeenCalledOnce();
    expect(textEngine.applyInterim).toHaveBeenCalledWith("hel", "fake:0");
    expect(events).not.toContainEqual({ type: "stop", reason: "user" });

    resolveCompletion([]);
    await stopPromise;
    expect(session.getSnapshot().status).toBe("idle");
    expect(events).toContainEqual({ type: "stop", reason: "user" });
  });

  it("reports transform failures non-destructively and still stops", async () => {
    const transformError = new VoiceInputError({
      code: "transform-error",
      message: "Transform failed.",
    });
    const textEngine = createFakeTextEngine({
      processing: true,
      result: Promise.resolve([transformError]),
    });
    const { session, events } = createSession({ textEngine });
    await session.start();
    await session.stop();

    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      error: transformError,
    });
    expect(events).toContainEqual({ type: "error", error: transformError });
    expect(events.at(-1)).toEqual({ type: "stop", reason: "user" });
  });

  it("cancels text ownership on cancellation and provider failure", async () => {
    const cancelledEngine = createFakeTextEngine();
    const cancelled = createSession({ textEngine: cancelledEngine });
    await cancelled.session.start();
    await cancelled.session.cancel();
    expect(cancelledEngine.cancel).toHaveBeenCalledOnce();

    const failedEngine = createFakeTextEngine();
    const failed = createSession({ textEngine: failedEngine });
    await failed.session.start();
    failed.provider.controller.fail(
      new VoiceInputError({
        code: "network-error",
        message: "offline",
      }),
    );
    await waitFor(() => {
      expect(failed.session.getSnapshot().status).toBe("error");
    });
    expect(failedEngine.cancel).toHaveBeenCalledOnce();
  });
});

describe("duration limits", () => {
  it("stops on backgrounding, releases capture, and can record again", async () => {
    const document = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", document);
    try {
      const { session, audio, events } = createSession();
      await session.start();
      document.hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
      expect(events).toContainEqual({ type: "stop", reason: "backgrounded" });
      expect(audio.sessions[0]?.stopCallCount).toBe(1);
      document.hidden = false;
      await session.start();
      expect(session.getSnapshot().status).toBe("listening");
      await session.cancel();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("counts startup capture toward the duration limit", async () => {
    vi.useFakeTimers();
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const { session, audio, events } = createSession({
      provider,
      maxDurationMs: 1000,
    });
    const starting = session.start();
    await provider.controller.waitForSession();
    await vi.advanceTimersByTimeAsync(1000);
    await starting;
    expect(session.getSnapshot().status).toBe("idle");
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
    expect(events).toContainEqual({ type: "stop", reason: "max-duration" });
  });
  it("retains audio produced during provider connection and sends it in order", async () => {
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const audio = createFakeAudioSource();
    const { session } = createSession({ provider, audio });
    const starting = session.start();
    await provider.controller.waitForSession();
    expect(audio.sessions[0]?.startCallCount).toBe(1);
    audio.emitChunk(new Int16Array([1, 2]));
    audio.emitChunk(new Int16Array([3, 4]));
    provider.controller.resolveOpen();
    await starting;
    await waitFor(() =>
      expect(provider.controller.sessions[0]?.audioChunks).toHaveLength(2),
    );
    expect(provider.controller.sessions[0]?.audioChunks).toEqual([
      new Int16Array([1, 2]),
      new Int16Array([3, 4]),
    ]);
    await session.stop();
  });

  it("fails safely when startup audio exceeds fifteen seconds", async () => {
    const provider = createFakeVoiceInputProvider({ autoOpen: false });
    const audio = createFakeAudioSource();
    const { session } = createSession({ provider, audio });
    const starting = session.start();
    await provider.controller.waitForSession();
    audio.emitChunk(new Int16Array(provider.provider.sampleRate * 15 + 1));
    await starting;
    expect(session.getSnapshot().error?.code).toBe("network-error");
    expect(audio.sessions[0]?.abortCallCount).toBe(1);
    expect(provider.controller.sessions[0]?.abortCallCount).toBe(1);
  });

  it("deduplicates finals by segment without removing legitimate repeated speech", async () => {
    const { session, provider } = createSession();
    await session.start();
    provider.controller.emit({ type: "final", text: "yes", segmentId: "one" });
    provider.controller.emit({ type: "final", text: "yes", segmentId: "one" });
    provider.controller.emit({ type: "final", text: "yes", segmentId: "two" });
    await waitFor(() =>
      expect(session.getSnapshot().finalTranscript).toBe("yes yes"),
    );
    await session.stop();
  });

  it("warns immediately for a short session and stops at the limit", async () => {
    vi.useFakeTimers();
    const { session, events } = createSession({ maxDurationMs: 1_000 });
    await session.start();

    expect(events).toContainEqual({
      type: "duration-warning",
      remainingMs: 1_000,
      maxDurationMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => {
      expect(session.getSnapshot().status).toBe("idle");
    });
    expect(events).toContainEqual({ type: "stop", reason: "max-duration" });
  });

  it("uses the five-minute default and warns once with thirty seconds left", async () => {
    vi.useFakeTimers();
    const { session, events } = createSession();
    await session.start();

    await vi.advanceTimersByTimeAsync(270_000);
    expect(events.filter((event) => event.type === "duration-warning")).toEqual(
      [
        {
          type: "duration-warning",
          remainingMs: 30_000,
          maxDurationMs: 300_000,
        },
      ],
    );
    await session.cancel();
  });

  it("suppresses stale timers after cancellation and restart", async () => {
    vi.useFakeTimers();
    const { session, events } = createSession({ maxDurationMs: 40_000 });
    await session.start();
    await session.cancel();
    await session.start();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(events.filter((event) => event.type === "duration-warning")).toEqual(
      [
        {
          type: "duration-warning",
          remainingMs: 30_000,
          maxDurationMs: 40_000,
        },
      ],
    );
    await session.cancel();
  });
});
