import type {
  VoiceInputProviderV1,
  VoiceInputProviderV1CallOptions,
  VoiceInputProviderV1Session,
  VoiceInputProviderV1StreamPart,
  VoiceTranscriptionOptions,
} from "./index.js";
import { VoiceInputError } from "./index.js";

export interface FakeVoiceInputProviderOptions {
  provider?: string;
  modelId?: string;
  sampleRate?: number;
  autoOpen?: boolean;
  autoCloseOnFinish?: boolean;
  validateOptions?: (options: VoiceTranscriptionOptions) => void;
}

export interface FakeVoiceInputProviderSessionSnapshot {
  readonly callOptions: VoiceInputProviderV1CallOptions;
  readonly audioChunks: readonly Int16Array[];
  readonly finishCallCount: number;
  readonly abortCallCount: number;
  readonly closed: boolean;
  readonly aborted: boolean;
}

export interface FakeVoiceInputProviderController {
  readonly sessions: readonly FakeVoiceInputProviderSessionSnapshot[];
  waitForSession(
    index?: number,
  ): Promise<FakeVoiceInputProviderSessionSnapshot>;
  resolveOpen(index?: number): void;
  rejectOpen(error: unknown, index?: number): void;
  emit(part: VoiceInputProviderV1StreamPart, index?: number): void;
  close(index?: number): void;
  fail(error: VoiceInputError, index?: number): void;
}

export interface FakeVoiceInputProvider {
  provider: VoiceInputProviderV1;
  controller: FakeVoiceInputProviderController;
}

interface MutableFakeSession {
  callOptions: VoiceInputProviderV1CallOptions;
  audioChunks: Int16Array[];
  finishCallCount: number;
  abortCallCount: number;
  closed: boolean;
  aborted: boolean;
  finished: boolean;
  opened: boolean;
  settled: boolean;
  streamController: ReadableStreamDefaultController<VoiceInputProviderV1StreamPart>;
  publicSession: VoiceInputProviderV1Session;
  open(): void;
  reject(error: unknown): void;
}

export function createFakeVoiceInputProvider(
  options: FakeVoiceInputProviderOptions = {},
): FakeVoiceInputProvider {
  const sessions: MutableFakeSession[] = [];
  const waiters = new Map<
    number,
    Array<(session: FakeVoiceInputProviderSessionSnapshot) => void>
  >();
  const autoOpen = options.autoOpen ?? true;
  const autoCloseOnFinish = options.autoCloseOnFinish ?? true;

  const getSession = (index = sessions.length - 1): MutableFakeSession => {
    const session = sessions[index];

    if (session === undefined) {
      throw new Error(`Fake provider session ${index} does not exist.`);
    }

    return session;
  };

  const getSnapshot = (
    session: MutableFakeSession,
  ): FakeVoiceInputProviderSessionSnapshot =>
    Object.freeze({
      callOptions: Object.freeze({ ...session.callOptions }),
      audioChunks: Object.freeze([...session.audioChunks]),
      finishCallCount: session.finishCallCount,
      abortCallCount: session.abortCallCount,
      closed: session.closed,
      aborted: session.aborted,
    });

  const close = (session: MutableFakeSession): void => {
    if (session.closed) {
      return;
    }

    session.closed = true;
    session.streamController.close();
  };

  const emit = (part: VoiceInputProviderV1StreamPart, index?: number): void => {
    const session = getSession(index);

    if (session.closed) {
      throw new Error("Cannot emit after the fake provider stream closed.");
    }

    session.streamController.enqueue(part);
  };

  const controller: FakeVoiceInputProviderController = {
    get sessions() {
      return Object.freeze(sessions.map(getSnapshot));
    },
    async waitForSession(index = 0) {
      const session = sessions[index];

      if (session !== undefined) {
        return getSnapshot(session);
      }

      return await new Promise<FakeVoiceInputProviderSessionSnapshot>(
        (resolve) => {
          const existingWaiters = waiters.get(index) ?? [];
          existingWaiters.push(resolve);
          waiters.set(index, existingWaiters);
        },
      );
    },
    resolveOpen(index) {
      getSession(index).open();
    },
    rejectOpen(error, index) {
      getSession(index).reject(error);
    },
    emit,
    close(index) {
      close(getSession(index));
    },
    fail(error, index) {
      emit({ type: "error", error }, index);
      close(getSession(index));
    },
  };

  const provider: VoiceInputProviderV1 = {
    specificationVersion: "v1",
    provider: options.provider ?? "fake",
    modelId: options.modelId ?? "fake-model",
    sampleRate: options.sampleRate ?? 16_000,
    validateOptions: options.validateOptions ?? (() => {}),
    doOpen(callOptions) {
      let streamController:
        | ReadableStreamDefaultController<VoiceInputProviderV1StreamPart>
        | undefined;
      const stream = new ReadableStream<VoiceInputProviderV1StreamPart>({
        start(controller_) {
          streamController = controller_;
        },
      });

      if (streamController === undefined) {
        throw new Error("The fake provider stream did not initialize.");
      }

      let resolveOpen: (
        session: VoiceInputProviderV1Session,
      ) => void = () => {};
      let rejectOpen: (error: unknown) => void = () => {};
      const openPromise = new Promise<VoiceInputProviderV1Session>(
        (resolve, reject) => {
          resolveOpen = resolve;
          rejectOpen = reject;
        },
      );

      const mutableSession: MutableFakeSession = {
        callOptions,
        audioChunks: [],
        finishCallCount: 0,
        abortCallCount: 0,
        closed: false,
        aborted: false,
        finished: false,
        opened: false,
        settled: false,
        streamController,
        publicSession: undefined as unknown as VoiceInputProviderV1Session,
        open() {
          if (mutableSession.settled) {
            return;
          }

          mutableSession.opened = true;
          mutableSession.settled = true;
          resolveOpen(mutableSession.publicSession);
        },
        reject(error) {
          if (mutableSession.settled) {
            return;
          }

          mutableSession.settled = true;
          close(mutableSession);
          rejectOpen(error);
        },
      };

      const publicSession: VoiceInputProviderV1Session = {
        stream,
        sendAudio(chunk) {
          if (!mutableSession.closed && !mutableSession.aborted) {
            mutableSession.audioChunks.push(chunk);
          }
        },
        finish() {
          if (
            mutableSession.closed ||
            mutableSession.aborted ||
            mutableSession.finished
          ) {
            return;
          }

          mutableSession.finished = true;
          mutableSession.finishCallCount += 1;

          if (autoCloseOnFinish) {
            close(mutableSession);
          }
        },
        abort(reason) {
          if (mutableSession.closed || mutableSession.aborted) {
            return;
          }

          mutableSession.aborted = true;
          mutableSession.abortCallCount += 1;
          close(mutableSession);

          if (!mutableSession.settled) {
            mutableSession.settled = true;
            rejectOpen(reason);
          }
        },
      };

      mutableSession.publicSession = publicSession;
      const index = sessions.push(mutableSession) - 1;

      for (const resolve of waiters.get(index) ?? []) {
        resolve(getSnapshot(mutableSession));
      }
      waiters.delete(index);

      callOptions.abortSignal.addEventListener(
        "abort",
        () => publicSession.abort(callOptions.abortSignal.reason),
        { once: true },
      );

      if (callOptions.abortSignal.aborted) {
        publicSession.abort(callOptions.abortSignal.reason);
      } else if (autoOpen) {
        mutableSession.open();
      }

      return openPromise;
    },
  };

  return { provider, controller };
}

export interface VoiceInputProviderV1ConformanceHarness {
  provider: VoiceInputProviderV1;
  controller: FakeVoiceInputProviderController;
}

export interface VoiceInputProviderV1ConformanceCase {
  name: string;
  run(): Promise<void>;
}

export interface VoiceInputProviderV1ConformanceOptions {
  createHarness(): VoiceInputProviderV1ConformanceHarness;
}

export class VoiceInputProviderConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceInputProviderConformanceError";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new VoiceInputProviderConformanceError(message);
  }
}

async function readStream(
  stream: ReadableStream<VoiceInputProviderV1StreamPart>,
): Promise<VoiceInputProviderV1StreamPart[]> {
  const parts: VoiceInputProviderV1StreamPart[] = [];

  for await (const part of stream) {
    parts.push(part);
  }

  return parts;
}

async function openSession(
  harness: VoiceInputProviderV1ConformanceHarness,
): Promise<VoiceInputProviderV1Session> {
  const sessionPromise = Promise.resolve().then(() =>
    harness.provider.doOpen({
      abortSignal: new AbortController().signal,
    }),
  );
  await harness.controller.waitForSession();
  harness.controller.resolveOpen();
  return await sessionPromise;
}

export function createVoiceInputProviderV1ConformanceCases(
  options: VoiceInputProviderV1ConformanceOptions,
): readonly VoiceInputProviderV1ConformanceCase[] {
  return [
    {
      name: "declares valid v1 metadata and accepts baseline options",
      async run() {
        const { provider } = options.createHarness();
        assert(provider.specificationVersion === "v1", "Expected v1 spec.");
        assert(provider.provider.length > 0, "Provider ID must not be empty.");
        assert(provider.modelId.length > 0, "Model ID must not be empty.");
        assert(
          Number.isInteger(provider.sampleRate) && provider.sampleRate > 0,
          "Sample rate must be a positive integer.",
        );
        provider.validateOptions({});
      },
    },
    {
      name: "streams normalized parts in order and closes terminally",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        const partsPromise = readStream(session.stream);
        harness.controller.emit({ type: "interim", text: "hel" });
        harness.controller.emit({ type: "interim", text: "hello" });
        harness.controller.emit({ type: "final", text: "hello" });
        harness.controller.emit({ type: "speech-start" });
        harness.controller.emit({ type: "speech-end" });
        harness.controller.close();
        const partTypes = (await partsPromise).map((part) => part.type);
        assert(
          partTypes.join(",") ===
            "interim,interim,final,speech-start,speech-end",
          `Unexpected stream order: ${partTypes.join(",")}`,
        );

        let postCloseThrew = false;
        try {
          harness.controller.emit({ type: "final", text: "late" });
        } catch {
          postCloseThrew = true;
        }
        assert(postCloseThrew, "Output must not be emitted after closure.");
      },
    },
    {
      name: "accepts audio chunks and finishes idempotently",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        await session.sendAudio(new Int16Array([1, 2]));
        await session.sendAudio(new Int16Array([3, 4]));
        await session.finish();
        await session.finish();
        const snapshot = harness.controller.sessions[0];
        assert(snapshot !== undefined, "Expected a provider session.");
        assert(snapshot.audioChunks.length === 2, "Expected two audio chunks.");
        assert(
          snapshot.finishCallCount === 1,
          "finish() must have only one observable effect.",
        );
      },
    },
    {
      name: "aborts immediately and idempotently",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        session.abort("test");
        session.abort("test-again");
        const snapshot = harness.controller.sessions[0];
        assert(snapshot?.aborted, "Session was not marked aborted.");
        assert(
          snapshot.abortCallCount === 1,
          "abort() must have only one observable effect.",
        );
      },
    },
    {
      name: "honors abort signals while opening",
      async run() {
        const harness = options.createHarness();
        const abortController = new AbortController();
        const sessionPromise = Promise.resolve().then(() =>
          harness.provider.doOpen({ abortSignal: abortController.signal }),
        );
        await harness.controller.waitForSession();
        abortController.abort("cancelled");

        let rejected = false;
        try {
          await sessionPromise;
        } catch {
          rejected = true;
        }

        assert(rejected, "An aborted open must reject.");
        assert(
          harness.controller.sessions[0]?.aborted,
          "An aborted open must tear down its pending session.",
        );
      },
    },
    {
      name: "reports an abnormal failure before stream completion",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        const partsPromise = readStream(session.stream);
        harness.controller.fail(
          new VoiceInputError({
            code: "provider-error",
            message: "Synthetic provider failure.",
            provider: harness.provider.provider,
          }),
        );
        const parts = await partsPromise;
        assert(parts.length === 1, "Expected exactly one error part.");
        assert(parts[0]?.type === "error", "Expected an error part.");
        assert(
          parts[0]?.type === "error" &&
            VoiceInputError.isInstance(parts[0].error),
          "Provider failures must use VoiceInputError.",
        );
      },
    },
  ];
}
