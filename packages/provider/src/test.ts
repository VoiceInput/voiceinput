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
  timeout(index?: number): PromiseLike<void> | void;
}

export interface FakeVoiceInputProvider {
  provider: VoiceInputProviderV1;
  controller: FakeVoiceInputProviderController;
}

interface MutableFakeSession {
  segmentSequence: number;
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
      return;
    }

    if (part.type === "interim" || part.type === "final") {
      session.streamController.enqueue({
        ...part,
        segmentId: part.segmentId ?? `fake:${session.segmentSequence}`,
      });
      if (part.type === "final") session.segmentSequence += 1;
    } else session.streamController.enqueue(part);
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
    timeout(index) {
      const session = getSession(index);
      emit(
        {
          type: "error",
          error: new VoiceInputError({
            code: "network-error",
            message: "The fake provider timed out.",
            provider: options.provider ?? "fake",
            retryable: true,
          }),
        },
        index,
      );
      close(session);
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
        segmentSequence: 0,
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
  createAccumulatorSession(
    provider: VoiceInputProviderV1,
    audioSource: {
      prepare(): PromiseLike<{
        readonly stream: ReadableStream<Int16Array>;
        start(): PromiseLike<void> | void;
        stop(): PromiseLike<void> | void;
        abort(reason?: unknown): void;
      }>;
    },
  ): {
    getSnapshot(): { readonly finalTranscript: string };
    start(): PromiseLike<void> | void;
    cancel(): PromiseLike<void> | void;
  };
  errorTaxonomy: {
    readonly createProvider?: () => VoiceInputProviderV1;
    readonly createUnsupportedBrowserProvider: () => VoiceInputProviderV1;
    readonly invalidOptions: VoiceTranscriptionOptions;
    readonly malformedUnsupportedOptions: VoiceTranscriptionOptions;
    readonly unsupportedOptions: VoiceTranscriptionOptions;
  };
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

function createConformanceAudioSource() {
  return {
    prepare() {
      let closed = false;
      let streamController:
        ReadableStreamDefaultController<Int16Array> | undefined;
      const stream = new ReadableStream<Int16Array>({
        start(controller) {
          streamController = controller;
        },
      });
      const close = (): void => {
        if (!closed) {
          closed = true;
          streamController?.close();
        }
      };
      return Promise.resolve({ stream, start() {}, stop: close, abort: close });
    },
  };
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new VoiceInputProviderConformanceError(message);
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
        harness.controller.emit({ type: "speech-start" });
        harness.controller.emit({ type: "interim", text: "hel" });
        harness.controller.emit({ type: "interim", text: "hello" });
        harness.controller.emit({ type: "final", text: "hello" });
        harness.controller.emit({ type: "speech-end" });
        harness.controller.close();
        const parts = await partsPromise;
        const transcripts = parts.filter(
          (part) => part.type === "interim" || part.type === "final",
        );
        assert(
          transcripts.every(
            (part) =>
              typeof part.segmentId === "string" && part.segmentId.length > 0,
          ),
          "Normalized transcript parts must include a non-empty segmentId.",
        );
        assert(
          new Set(transcripts.map((part) => part.segmentId)).size === 1,
          "Interim revisions and their final must keep the same segmentId.",
        );
        const partTypes = parts.map((part) => part.type);
        assert(
          partTypes.join(",") ===
            "speech-start,interim,interim,final,speech-end",
          `Unexpected stream order: ${partTypes.join(",")}`,
        );

        harness.controller.emit({ type: "final", text: "late" });
        const lateReader = session.stream.getReader();
        const lateResult = await lateReader.read();
        lateReader.releaseLock();
        assert(
          lateResult.done,
          `Output must not be emitted after closure: ${JSON.stringify(lateResult)}.`,
        );
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
      name: "drains a delayed provider final after finish",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        const partsPromise = readStream(session.stream);
        await session.sendAudio(new Int16Array([1]));
        harness.controller.emit({ type: "interim", text: "draft" });
        const finishPromise = Promise.resolve(session.finish());

        await Promise.resolve();
        harness.controller.emit({ type: "final", text: "corrected." });
        harness.controller.close();
        await finishPromise;

        const parts = await partsPromise;
        const finals = parts.filter(
          (part) => part.type === "final" && part.text.length > 0,
        );
        assert(finals.length === 1, "Expected one delayed final part.");
        assert(
          finals[0]?.type === "final" && finals[0].text === "corrected.",
          "finish() must preserve the provider's corrected final text.",
        );
      },
    },
    {
      name: "never promotes interim text when finish has no final",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        const partsPromise = readStream(session.stream);
        await session.sendAudio(new Int16Array([1]));
        harness.controller.emit({ type: "interim", text: "mutable draft" });
        const finishPromise = Promise.resolve(session.finish());

        await Promise.resolve();
        harness.controller.close();
        await finishPromise;

        const parts = await partsPromise;
        assert(
          !parts.some((part) => part.type === "final" && part.text.length > 0),
          "Interim text must not be relabeled as final during finish().",
        );
      },
    },
    {
      name: "feeds multiple final chunks through the shared accumulator",
      async run() {
        const harness = options.createHarness();
        const accumulator = options.createAccumulatorSession(
          harness.provider,
          createConformanceAudioSource(),
        );
        const startPromise = Promise.resolve(accumulator.start());
        await harness.controller.waitForSession();
        harness.controller.resolveOpen();
        await startPromise;
        harness.controller.emit({ type: "final", text: "one" });
        harness.controller.emit({ type: "final", text: "two" });
        harness.controller.emit({ type: "final", text: "," });
        harness.controller.emit({ type: "final", text: "three" });
        await waitFor(
          () => accumulator.getSnapshot().finalTranscript === "one two, three",
          `Unexpected accumulated transcript: ${accumulator.getSnapshot().finalTranscript}`,
        );
        await accumulator.cancel();
      },
    },
    {
      name: "maps a terminal timeout and closes the stream",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        const partsPromise = readStream(session.stream);
        await session.sendAudio(new Int16Array([1]));
        const finishOutcome = Promise.resolve(session.finish()).then(
          () => undefined,
          () => undefined,
        );

        await harness.controller.timeout();
        await finishOutcome;
        const parts = await partsPromise;
        const errorParts = parts.filter((part) => part.type === "error");
        assert(errorParts.length === 1, "Expected one terminal timeout error.");
        assert(
          errorParts[0]?.error.code === "network-error",
          `Expected network-error, received ${errorParts[0]?.error.code}.`,
        );
        assert(
          errorParts[0]?.error.retryable,
          "Provider timeouts must be retryable.",
        );
      },
    },
    {
      name: "aborts immediately and idempotently",
      async run() {
        const harness = options.createHarness();
        const session = await openSession(harness);
        const partsPromise = readStream(session.stream);
        session.abort("test");
        session.abort("test-again");
        await partsPromise;
        const snapshot = harness.controller.sessions[0];
        assert(snapshot?.aborted, "Session was not marked aborted.");
        assert(snapshot.closed, "Abort must close the provider session.");
        assert(
          snapshot.abortCallCount === 1,
          "abort() must have only one observable effect.",
        );
        harness.controller.emit({ type: "final", text: "late" });
        const lateReader = session.stream.getReader();
        const lateResult = await lateReader.read();
        lateReader.releaseLock();
        assert(
          lateResult.done,
          `Output must not be emitted after abort: ${JSON.stringify(lateResult)}.`,
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
    {
      name: "classifies malformed portable options as invalid configuration",
      async run() {
        const provider =
          options.errorTaxonomy.createProvider?.() ??
          options.createHarness().provider;
        const error = captureValidationError(
          provider,
          options.errorTaxonomy.invalidOptions,
        );
        assert(
          error.code === "invalid-configuration",
          `Expected invalid-configuration, received ${error.code}.`,
        );
        assert(
          error.provider === provider.provider,
          "Validation errors must identify their provider.",
        );
        assert(
          error.cause instanceof Error,
          "Invalid configuration must preserve its validation cause.",
        );
      },
    },
    {
      name: "classifies valid unavailable options as unsupported features",
      async run() {
        const provider =
          options.errorTaxonomy.createProvider?.() ??
          options.createHarness().provider;
        const error = captureValidationError(
          provider,
          options.errorTaxonomy.unsupportedOptions,
        );
        assert(
          error.code === "unsupported-feature",
          `Expected unsupported-feature, received ${error.code}.`,
        );
        assert(
          error.provider === provider.provider,
          "Unsupported-feature errors must identify their provider.",
        );
      },
    },
    {
      name: "reports malformed options before capability limits",
      async run() {
        const provider =
          options.errorTaxonomy.createProvider?.() ??
          options.createHarness().provider;
        const error = captureValidationError(
          provider,
          options.errorTaxonomy.malformedUnsupportedOptions,
        );
        assert(
          error.code === "invalid-configuration",
          `Expected malformed precedence, received ${error.code}.`,
        );
      },
    },
    {
      name: "classifies missing runtime APIs as unsupported browser",
      async run() {
        const provider =
          options.errorTaxonomy.createUnsupportedBrowserProvider();
        let caught: unknown;
        try {
          await provider.doOpen({
            abortSignal: new AbortController().signal,
          });
        } catch (error) {
          caught = error;
        }
        assert(
          VoiceInputError.isInstance(caught),
          "Missing browser APIs must produce VoiceInputError.",
        );
        assert(
          caught.code === "unsupported-browser",
          `Expected unsupported-browser, received ${caught.code}.`,
        );
        assert(
          caught.provider === provider.provider,
          "Unsupported-browser errors must identify their provider.",
        );
      },
    },
  ];
}

function captureValidationError(
  provider: VoiceInputProviderV1,
  options: VoiceTranscriptionOptions,
): VoiceInputError {
  let caught: unknown;
  try {
    provider.validateOptions(options);
  } catch (error) {
    caught = error;
  }
  assert(
    VoiceInputError.isInstance(caught),
    "Validation failures must use VoiceInputError.",
  );
  return caught;
}
