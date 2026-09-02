import { createVoiceInputSession } from "@voiceinput/core";
import {
  VoiceInputError,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";
import {
  createVoiceInputProviderV1ConformanceCases,
  type FakeVoiceInputProviderController,
  type FakeVoiceInputProviderSessionSnapshot,
} from "@voiceinput/provider/test";
import { describe, expect, it, vi } from "vitest";

import { openai } from "./index.js";

describe("openai", () => {
  it("validates OpenAI language support synchronously", () => {
    const provider = createProvider(createTransport());

    expect(() => provider.validateOptions({ language: "en-CA" })).not.toThrow();
    expect(() => provider.validateOptions({ language: "haw" })).toThrowError(
      expect.objectContaining({
        code: "unsupported-feature",
        provider: "openai",
      }),
    );
    expect(() =>
      provider.validateOptions({
        vocabulary: Array.from({ length: 101 }, () => "term"),
      }),
    ).toThrowError(expect.objectContaining({ code: "unsupported-feature" }));
    expect(() =>
      provider.validateOptions({ vocabulary: ["x".repeat(201)] }),
    ).toThrowError(expect.objectContaining({ code: "unsupported-feature" }));
    expect(() =>
      provider.validateOptions({ vocabulary: [" untrimmed"] }),
    ).toThrowError(expect.objectContaining({ code: "invalid-configuration" }));
  });

  it("streams accumulated deltas, ordered finals, speech boundaries, and PCM16", async () => {
    const transport = createTransport();
    const provider = createProvider(transport);
    const sessionPromise = Promise.resolve(
      provider.doOpen({
        abortSignal: new AbortController().signal,
        language: "en-CA",
        vocabulary: ["VoiceInput"],
        endpointing: { silenceMs: 650 },
      }),
    );
    const socket = await transport.waitForSocket();
    expect(socket.url.href).toBe("wss://api.openai.com/v1/realtime");
    expect(socket.protocols).toEqual([
      "realtime",
      "openai-insecure-api-key.ek_test",
    ]);
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    expect(socket.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            transcription: {
              model: "gpt-live-transcribe",
              languages: ["en"],
              keywords: ["VoiceInput"],
            },
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 650,
            },
          },
        },
      },
    });

    session.sendAudio(new Int16Array([1, -2]));
    socket.message({ type: "input_audio_buffer.speech_started" });
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "item-1",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "hel",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "lo",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "hello",
    });
    socket.message({ type: "input_audio_buffer.speech_stopped" });

    session.finish();
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "item-2",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-2",
      transcript: "world",
    });

    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "interim", text: "hel" },
      { type: "interim", text: "hello" },
      { type: "final", text: "hello" },
      { type: "speech-end" },
      { type: "final", text: "world" },
    ]);
    expect(decodeAudio(socket.sent[1]?.["audio"])).toEqual(
      new Int16Array([1, -2]),
    );
    expect(
      socket.sent.filter(
        (event) => event["type"] === "input_audio_buffer.commit",
      ),
    ).toHaveLength(0);
    expect(socket.closeReason).toBe("finished");
  });

  it("holds out-of-order completed turns until earlier turns finish", async () => {
    const transport = createTransport();
    const provider = createProvider(transport);
    const sessionPromise = Promise.resolve(
      provider.doOpen({ abortSignal: new AbortController().signal }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const reader = session.stream.getReader();

    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "first",
    });
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "second",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "first",
      delta: "fir",
    });
    await expect(reader.read()).resolves.toMatchObject({
      value: { type: "interim", text: "fir" },
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "second",
      transcript: "second",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "first",
      transcript: "first",
    });

    await expect(reader.read()).resolves.toMatchObject({
      value: { type: "final", text: "first" },
    });
    await expect(reader.read()).resolves.toMatchObject({
      value: { type: "final", text: "second" },
    });
    session.abort();
  });

  it("tolerates the empty final commit after an already completed VAD turn", async () => {
    const transport = createTransport();
    const provider = createProvider(transport);
    const sessionPromise = Promise.resolve(
      provider.doOpen({ abortSignal: new AbortController().signal }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    session.sendAudio(new Int16Array([1, 2]));
    socket.message({ type: "input_audio_buffer.speech_started" });
    socket.message({ type: "input_audio_buffer.speech_stopped" });
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "vad-turn",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "vad-turn",
      transcript: "done",
    });
    session.finish();
    socket.message({
      type: "error",
      error: {
        code: "input_audio_buffer_commit_empty",
        event_id: "voiceinput-finish",
      },
    });

    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "speech-end" },
      { type: "final", text: "done" },
    ]);
    expect(socket.sent.at(-1)).toEqual({
      type: "input_audio_buffer.commit",
      event_id: "voiceinput-finish",
    });
    expect(socket.closeReason).toBe("finished");
  });

  it("commits audio sent after an earlier VAD turn even before speech starts", async () => {
    const transport = createTransport();
    const provider = createProvider(transport);
    const sessionPromise = Promise.resolve(
      provider.doOpen({ abortSignal: new AbortController().signal }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    session.sendAudio(new Int16Array([1, 2]));
    socket.message({ type: "input_audio_buffer.speech_started" });
    socket.message({ type: "input_audio_buffer.speech_stopped" });
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "first-turn",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "first-turn",
      transcript: "first",
    });

    session.sendAudio(new Int16Array([3, 4]));
    session.finish();
    expect(socket.sent.at(-1)).toEqual({
      type: "input_audio_buffer.commit",
      event_id: "voiceinput-finish",
    });
    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "short-turn",
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "short-turn",
      transcript: "short",
    });

    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "speech-end" },
      { type: "final", text: "first" },
      { type: "final", text: "short" },
    ]);
    expect(socket.closeReason).toBe("finished");
  });

  it("normalizes transcription failures and tolerates its own empty final commit", async () => {
    const failedTransport = createTransport();
    const failedProvider = createProvider(failedTransport);
    const failedSessionPromise = Promise.resolve(
      failedProvider.doOpen({ abortSignal: new AbortController().signal }),
    );
    const failedSocket = await failedTransport.waitForSocket();
    failedSocket.open();
    const failedSession = await failedSessionPromise;
    const failedParts = readStream(failedSession.stream);
    failedSocket.message({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "failed-turn",
      error: { code: "transcription_failed", message: "Could not decode." },
    });

    await expect(failedParts).resolves.toMatchObject([
      {
        type: "error",
        error: { code: "provider-error", provider: "openai" },
      },
    ]);

    const emptyTransport = createTransport();
    const emptyProvider = createProvider(emptyTransport);
    const emptySessionPromise = Promise.resolve(
      emptyProvider.doOpen({ abortSignal: new AbortController().signal }),
    );
    const emptySocket = await emptyTransport.waitForSocket();
    emptySocket.open();
    const emptySession = await emptySessionPromise;
    const emptyParts = readStream(emptySession.stream);
    emptySession.sendAudio(new Int16Array([1, 2]));
    emptySession.finish();
    emptySocket.message({
      type: "error",
      error: {
        code: "input_audio_buffer_commit_empty",
        event_id: "voiceinput-finish",
      },
    });

    await expect(emptyParts).resolves.toEqual([]);
    expect(emptySocket.closeReason).toBe("finished");
  });

  it("normalizes token endpoint and Realtime failures", async () => {
    const limited = openai({
      tokenEndpoint: "/token",
      fetch: async () =>
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
    });
    await expect(
      limited.doOpen({ abortSignal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: "rate-limited",
      retryAfterMs: 2_000,
    });

    const configured = openai({
      tokenEndpoint: "/token",
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "invalid-configuration",
              message: "Choose an allowed transcription model.",
            },
          },
          { status: 400, headers: { "X-VoiceInput-Error": "1" } },
        ),
    });
    await expect(
      configured.doOpen({ abortSignal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: "invalid-configuration",
      message: "Choose an allowed transcription model.",
    });

    const untrusted = openai({
      tokenEndpoint: "/token",
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "invalid-configuration",
              message: "reflected upstream content",
            },
          },
          { status: 400 },
        ),
    });
    await expect(
      untrusted.doOpen({ abortSignal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "token-error" });

    const brokenBody = openai({
      tokenEndpoint: "/token",
      fetch: async () =>
        new Response(failingBody(), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "X-VoiceInput-Error": "1",
          },
        }),
    });
    await expect(
      brokenBody.doOpen({ abortSignal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "token-error", provider: "openai" });

    const transport = createTransport();
    const provider = createProvider(transport);
    const sessionPromise = Promise.resolve(
      provider.doOpen({ abortSignal: new AbortController().signal }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const reader = session.stream.getReader();
    socket.message({
      type: "error",
      error: { code: "rate_limit_exceeded", message: "Slow down." },
    });

    const result = await reader.read();
    expect(result.value).toMatchObject({
      type: "error",
      error: { code: "rate-limited", provider: "openai", retryable: true },
    });
    expect(
      result.value?.type === "error" &&
        VoiceInputError.isInstance(result.value.error),
    ).toBe(true);
  });
});

describe("OpenAI provider conformance", () => {
  const cases = createVoiceInputProviderV1ConformanceCases({
    createHarness: createConformanceHarness,
    createAccumulatorSession: (provider, audioSource) =>
      createVoiceInputSession({ provider, audioSource }),
    errorTaxonomy: {
      createUnsupportedBrowserProvider: () =>
        openai({
          tokenEndpoint: "/token",
          fetch: vi.fn<typeof fetch>(),
          webSocket: 0 as unknown as typeof WebSocket,
        }),
      invalidOptions: { language: "not a tag" },
      malformedUnsupportedOptions: {
        vocabulary: Array.from({ length: 101 }, () => 42),
      } as unknown as VoiceTranscriptionOptions,
      unsupportedOptions: { language: "haw" },
    },
  });

  it.each(cases)("$name", async (testCase) => {
    await expect(testCase.run()).resolves.toBeUndefined();
  });
});

function createProvider(transport: TestTransport) {
  return openai({
    tokenEndpoint: "/token",
    fetch: transport.fetch,
    webSocket: MockWebSocket as unknown as typeof WebSocket,
  });
}

function failingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      controller.error(new Error("broken body"));
    },
  });
}

function createTransport(): TestTransport {
  let socket: MockWebSocket | undefined;
  const waiters: Array<(socket: MockWebSocket) => void> = [];
  MockWebSocket.onConstruct = (nextSocket) => {
    socket = nextSocket;
    for (const resolve of waiters.splice(0)) {
      resolve(nextSocket);
    }
  };
  return {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({ value: "ek_test", expires_at: 2_000_000_000 }),
    ),
    async waitForSocket() {
      if (socket !== undefined) {
        return socket;
      }
      return await new Promise<MockWebSocket>((resolve) =>
        waiters.push(resolve),
      );
    },
  };
}

interface TestTransport {
  fetch: typeof fetch;
  waitForSocket(): Promise<MockWebSocket>;
}

class MockWebSocket extends EventTarget {
  static onConstruct: ((socket: MockWebSocket) => void) | undefined;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: URL;
  readonly protocols: readonly string[];
  readonly sent: Array<Record<string, unknown>> = [];
  readyState = MockWebSocket.CONNECTING;
  closeReason: string | undefined;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = new URL(url);
    this.protocols =
      typeof protocols === "string" ? [protocols] : (protocols ?? []);
    MockWebSocket.onConstruct?.(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("Socket is not open.");
    }
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  message(value: Record<string, unknown>): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }

  close(_code?: number, reason?: string): void {
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
  }

  remoteClose(code = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = new Event("close") as CloseEvent;
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }

  fail(): void {
    this.dispatchEvent(new Event("error"));
  }
}

function createConformanceHarness(): {
  provider: ReturnType<typeof openai>;
  controller: FakeVoiceInputProviderController;
} {
  const transport = createTransport();
  const provider = createProvider(transport);
  let socket: MockWebSocket | undefined;
  let interim = "";
  let itemId = 0;
  const getSocket = async (): Promise<MockWebSocket> => {
    socket ??= await transport.waitForSocket();
    return socket;
  };
  const requireSocket = (): MockWebSocket => {
    if (socket === undefined) {
      throw new Error("The OpenAI test session does not exist.");
    }
    return socket;
  };
  const snapshot = (): FakeVoiceInputProviderSessionSnapshot => ({
    callOptions: { abortSignal: new AbortController().signal },
    audioChunks: Object.freeze(
      (socket?.sent ?? [])
        .filter((event) => event["type"] === "input_audio_buffer.append")
        .map((event) => decodeAudio(event["audio"])),
    ),
    finishCallCount: (socket?.sent ?? []).filter(
      (event) => event["type"] === "input_audio_buffer.commit",
    ).length,
    abortCallCount: socket?.closeReason === "aborted" ? 1 : 0,
    closed: socket?.readyState === MockWebSocket.CLOSED,
    aborted: socket?.closeReason === "aborted",
  });
  const controller: FakeVoiceInputProviderController = {
    get sessions() {
      return socket === undefined ? [] : [snapshot()];
    },
    async waitForSession() {
      await getSocket();
      return snapshot();
    },
    resolveOpen() {
      requireSocket().open();
    },
    rejectOpen() {
      requireSocket().fail();
    },
    emit(part) {
      const activeSocket = requireSocket();
      if (part.type === "interim") {
        const delta = part.text.startsWith(interim)
          ? part.text.slice(interim.length)
          : part.text;
        interim = part.text;
        activeSocket.message({
          type: "conversation.item.input_audio_transcription.delta",
          item_id: `item-${itemId}`,
          delta,
        });
      } else if (part.type === "final") {
        activeSocket.message({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: `item-${itemId++}`,
          transcript: part.text,
        });
        interim = "";
      } else if (part.type === "speech-start") {
        activeSocket.message({ type: "input_audio_buffer.speech_started" });
      } else if (part.type === "speech-end") {
        activeSocket.message({ type: "input_audio_buffer.speech_stopped" });
      } else {
        activeSocket.message({
          type: "error",
          error: { code: part.error.code, message: part.error.message },
        });
      }
    },
    close() {
      requireSocket().remoteClose();
    },
    fail(error) {
      requireSocket().message({
        type: "error",
        error: { code: error.code, message: error.message },
      });
    },
    timeout() {
      requireSocket().remoteClose(1006);
    },
  };
  return { provider, controller };
}

function decodeAudio(value: unknown): Int16Array {
  if (typeof value !== "string") {
    throw new TypeError("Expected encoded audio.");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Int16Array(bytes.buffer);
}

async function readStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of stream) {
    values.push(value);
  }
  return values;
}
