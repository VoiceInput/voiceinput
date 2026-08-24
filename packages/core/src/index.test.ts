import {
  VoiceInputError,
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
  resolveStop: () => void;
}

interface FakeAudioSource {
  audioSource: VoiceAudioSource;
  sessions: AudioInspection[];
  prepareCallCount: number;
  resolvePrepare(index?: number): void;
  rejectPrepare(error: unknown, index?: number): void;
  resolveStop(index?: number): void;
  emitChunk(chunk: Int16Array, index?: number): void;
  emitInvalidChunk(index?: number): void;
}

function createFakeAudioSource(
  options: {
    autoPrepare?: boolean;
    autoStop?: boolean;
    startError?: unknown;
    stopError?: unknown;
  } = {},
): FakeAudioSource {
  const sessions: AudioInspection[] = [];
  const autoPrepare = options.autoPrepare ?? true;
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
          resolveStop,
        };
        const prepared: PreparedVoiceAudioSource = {
          stream,
          start() {
            inspection.startCallCount += 1;
            if (options.startError !== undefined) {
              throw options.startError;
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
    language?: string;
    vocabulary?: readonly string[];
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
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.vocabulary === undefined
      ? {}
      : { vocabulary: options.vocabulary }),
  });
  const events: VoiceInputSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return { session, provider, audio, events };
}

async function waitFor(assertion: () => void, timeout = 1_000): Promise<void> {
  await vi.waitFor(assertion, { timeout, interval: 1 });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("throws synchronously for invalid public configuration", () => {
    const provider = createFakeVoiceInputProvider();
    const audio = createFakeAudioSource();

    expect(() =>
      createVoiceInputSession({
        provider: provider.provider,
        audioSource: audio.audioSource,
        language: "en_US",
      }),
    ).toThrow(/language/);
    expect(() =>
      createVoiceInputSession({
        provider: provider.provider,
        audioSource: audio.audioSource,
        maxDurationMs: 0,
      }),
    ).toThrow(/maxDurationMs/);
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
    provider.controller.emit({ type: "final", text: " world" });
    await waitFor(() => {
      expect(session.getSnapshot().finalTranscript).toBe("hello world");
    });

    audio.emitChunk(new Int16Array([1, 2]));
    audio.emitChunk(new Int16Array([3, 4]));
    await waitFor(() => {
      expect(provider.controller.sessions[0]?.audioChunks).toHaveLength(2);
    });
    await session.stop();

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
    const { session } = createSession({ provider });
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
});

describe("duration limits", () => {
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
