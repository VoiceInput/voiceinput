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

import { elevenlabs } from "./index.js";

describe("elevenlabs", () => {
  it("maps shared and provider settings onto Realtime Scribe", async () => {
    const transport = createTransport();
    const provider = elevenlabs({
      tokenEndpoint: "/token",
      fetch: transport.fetch,
      webSocket: MockWebSocket as unknown as typeof WebSocket,
      vadThreshold: 0.35,
      minSpeechDurationMs: 120,
      noVerbatim: true,
    });
    const sessionPromise = Promise.resolve(
      provider.doOpen({
        abortSignal: new AbortController().signal,
        language: "en-CA",
        vocabulary: ["VoiceInput", "Scribe"],
        endpointing: { silenceMs: 650 },
      }),
    );
    const socket = await transport.waitForSocket();

    expect(socket.url.origin + socket.url.pathname).toBe(
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    );
    expect(socket.url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(socket.url.searchParams.get("token")).toBe("sutkn_test");
    expect(socket.url.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(socket.url.searchParams.get("language_code")).toBe("en");
    expect(socket.url.searchParams.getAll("keyterms")).toEqual([
      "VoiceInput",
      "Scribe",
    ]);
    expect(socket.url.searchParams.get("commit_strategy")).toBe("vad");
    expect(socket.url.searchParams.get("vad_silence_threshold_secs")).toBe(
      "0.65",
    );
    expect(socket.url.searchParams.get("vad_threshold")).toBe("0.35");
    expect(socket.url.searchParams.get("min_speech_duration_ms")).toBe("120");
    expect(socket.url.searchParams.get("no_verbatim")).toBe("true");

    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);
    session.sendAudio(new Int16Array([1, -2]));
    socket.message({ message_type: "partial_transcript", text: "hel" });
    socket.message({ message_type: "final_transcript", text: "hello" });
    const firstFinish = session.finish();
    expect(session.finish()).toBe(firstFinish);
    socket.message({ message_type: "committed_transcript", text: "hello!" });
    await firstFinish;

    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "interim", text: "hel", segmentId: expect.any(String) },
      { type: "final", text: "hello!", segmentId: expect.any(String) },
      { type: "speech-end" },
    ]);
    expect(decodeAudio(socket.json[0]?.["audio_base_64"])).toEqual(
      new Int16Array([1, -2]),
    );
    expect(socket.json[1]).toEqual({
      message_type: "input_audio_chunk",
      audio_base_64: "",
      commit: true,
      sample_rate: 16_000,
    });
    expect(socket.closeReason).toBe("finished");
  });

  it("uses a responsive VAD default and validates VAD ranges", async () => {
    const defaultTransport = createTransport();
    const defaultSession = Promise.resolve(
      createProvider(defaultTransport).doOpen({
        abortSignal: new AbortController().signal,
      }),
    );
    const defaultSocket = await defaultTransport.waitForSocket();
    expect(defaultSocket.url.searchParams.get("commit_strategy")).toBe("vad");
    expect(
      defaultSocket.url.searchParams.get("vad_silence_threshold_secs"),
    ).toBe("0.65");
    defaultSocket.open();
    (await defaultSession).abort();

    const manualTransport = createTransport();
    const manualSession = Promise.resolve(
      createProvider(manualTransport).doOpen({
        abortSignal: new AbortController().signal,
        endpointing: false,
      }),
    );
    const manualSocket = await manualTransport.waitForSocket();
    expect(manualSocket.url.searchParams.get("commit_strategy")).toBe("manual");
    manualSocket.open();
    (await manualSession).abort();

    expect(() =>
      elevenlabs({ tokenEndpoint: "/token", vadThreshold: 0.09 }),
    ).toThrowError(expect.objectContaining({ code: "invalid-configuration" }));
    expect(() =>
      elevenlabs({ tokenEndpoint: "/token", minSpeechDurationMs: 49 }),
    ).toThrowError(expect.objectContaining({ code: "invalid-configuration" }));
    expect(() =>
      elevenlabs({ tokenEndpoint: "/token", minSilenceDurationMs: 2_001 }),
    ).toThrowError(expect.objectContaining({ code: "invalid-configuration" }));
    expect(() =>
      createProvider(createTransport()).validateOptions({
        endpointing: null as never,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-configuration" }));
    expect(() =>
      elevenlabs({
        tokenEndpoint: "/token",
        vadThreshold: 0.1,
        minSpeechDurationMs: 50,
        minSilenceDurationMs: 2_000,
      }),
    ).not.toThrow();
  });

  it("waits for the committed final and never promotes a partial result", async () => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
        endpointing: { silenceMs: 650 },
      }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    session.sendAudio(new Int16Array([1]));
    socket.message({ message_type: "partial_transcript", text: "first" });
    session.sendAudio(new Int16Array([2]));
    socket.message({ message_type: "partial_transcript", text: "second" });
    socket.message({ message_type: "final_transcript", text: "first" });
    socket.message({ message_type: "committed_transcript", text: "first" });
    const finish = Promise.resolve(session.finish());
    let finished = false;
    void finish.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    socket.message({
      message_type: "committed_transcript",
      text: "second corrected.",
    });
    await finish;

    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "interim", text: "first", segmentId: expect.any(String) },
      { type: "interim", text: "second", segmentId: expect.any(String) },
      { type: "final", text: "first", segmentId: expect.any(String) },
      { type: "speech-end" },
      { type: "speech-start" },
      {
        type: "final",
        text: "second corrected.",
        segmentId: expect.any(String),
      },
      { type: "speech-end" },
    ]);
    expect(socket.closeReason).toBe("finished");
    expect(socket.json[0]).toMatchObject({
      message_type: "input_audio_chunk",
      commit: false,
      sample_rate: 16_000,
    });
  });

  it("does not confuse a delayed prior VAD commit with the finish commit", async () => {
    vi.useFakeTimers();
    try {
      const transport = createTransport();
      const sessionPromise = Promise.resolve(
        createProvider(transport).doOpen({
          abortSignal: new AbortController().signal,
          endpointing: { silenceMs: 650 },
        }),
      );
      const socket = await transport.waitForSocket();
      socket.open();
      const session = await sessionPromise;
      const partsPromise = readStream(session.stream);

      session.sendAudio(new Int16Array([1]));
      socket.message({ message_type: "partial_transcript", text: "first" });
      socket.message({ message_type: "partial_transcript", text: "second" });
      const finish = Promise.resolve(session.finish());
      let finished = false;
      void finish.then(() => {
        finished = true;
      });

      socket.message({ message_type: "committed_transcript", text: "first" });
      await vi.advanceTimersByTimeAsync(249);
      expect(finished).toBe(false);
      expect(socket.closeReason).toBeUndefined();

      socket.message({
        message_type: "committed_transcript",
        text: "entirely revised.",
      });
      await vi.advanceTimersByTimeAsync(250);
      await finish;

      expect(await partsPromise).toEqual([
        { type: "speech-start" },
        { type: "interim", text: "first", segmentId: expect.any(String) },
        { type: "interim", text: "second", segmentId: expect.any(String) },
        { type: "final", text: "first", segmentId: expect.any(String) },
        {
          type: "final",
          text: "entirely revised.",
          segmentId: expect.any(String),
        },
        { type: "speech-end" },
      ]);
      expect(socket.closeReason).toBe("finished");
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts an empty committed result after a partial", async () => {
    vi.useFakeTimers();
    try {
      const transport = createTransport();
      const sessionPromise = Promise.resolve(
        createProvider(transport).doOpen({
          abortSignal: new AbortController().signal,
        }),
      );
      const socket = await transport.waitForSocket();
      socket.open();
      const session = await sessionPromise;
      const partsPromise = readStream(session.stream);

      session.sendAudio(new Int16Array([1]));
      socket.message({ message_type: "partial_transcript", text: "noise" });
      const finish = Promise.resolve(session.finish());
      socket.message({ message_type: "committed_transcript", text: "" });
      await vi.advanceTimersByTimeAsync(250);

      await expect(finish).resolves.toBeUndefined();
      expect(await partsPromise).toEqual([
        { type: "speech-start" },
        { type: "interim", text: "noise", segmentId: expect.any(String) },
        { type: "final", text: "", segmentId: expect.any(String) },
        { type: "speech-end" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a normal terminal close while waiting for a commit", async () => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
      }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    session.sendAudio(new Int16Array([1]));
    socket.message({ message_type: "partial_transcript", text: "draft" });
    const finish = Promise.resolve(session.finish());
    socket.remoteClose(1000);

    await expect(finish).resolves.toBeUndefined();
    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "interim", text: "draft", segmentId: expect.any(String) },
      { type: "interim", text: "", segmentId: expect.any(String) },
      { type: "speech-end" },
    ]);
  });

  it("rejects finish when the connection closes abnormally", async () => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
      }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    session.sendAudio(new Int16Array([1]));
    const finish = Promise.resolve(session.finish());
    socket.remoteClose(1006);

    await expect(finish).rejects.toMatchObject({
      code: "network-error",
      provider: "elevenlabs",
      retryable: true,
    });
    expect(await partsPromise).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "network-error" }),
      }),
    ]);
  });

  it("times out a missing committed transcript with a typed error", async () => {
    vi.useFakeTimers();
    try {
      const transport = createTransport();
      const provider = elevenlabs({
        tokenEndpoint: "/token",
        fetch: transport.fetch,
        webSocket: MockWebSocket as unknown as typeof WebSocket,
        finishTimeoutMs: 25,
      });
      const sessionPromise = Promise.resolve(
        provider.doOpen({ abortSignal: new AbortController().signal }),
      );
      const socket = await transport.waitForSocket();
      socket.open();
      const session = await sessionPromise;
      const partsPromise = readStream(session.stream);

      session.sendAudio(new Int16Array([1]));
      const finish = Promise.resolve(session.finish());
      const finishError = finish.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(25);

      expect(await finishError).toMatchObject({
        code: "network-error",
        provider: "elevenlabs",
        retryable: true,
      });
      expect(await partsPromise).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ code: "network-error" }),
        }),
      ]);
      expect(socket.closeReason).toBe("aborted");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the finish deadline absolute after transcript activity", async () => {
    vi.useFakeTimers();
    try {
      const transport = createTransport();
      const provider = elevenlabs({
        tokenEndpoint: "/token",
        fetch: transport.fetch,
        webSocket: MockWebSocket as unknown as typeof WebSocket,
        finishTimeoutMs: 25,
      });
      const sessionPromise = Promise.resolve(
        provider.doOpen({ abortSignal: new AbortController().signal }),
      );
      const socket = await transport.waitForSocket();
      socket.open();
      const session = await sessionPromise;
      const partsPromise = readStream(session.stream);

      session.sendAudio(new Int16Array([1]));
      const finishError = Promise.resolve(session.finish()).catch(
        (error: unknown) => error,
      );
      socket.message({ message_type: "committed_transcript", text: "first" });
      await vi.advanceTimersByTimeAsync(20);
      socket.message({ message_type: "partial_transcript", text: "more" });
      await vi.advanceTimersByTimeAsync(5);

      expect(await finishError).toMatchObject({
        code: "network-error",
        provider: "elevenlabs",
      });
      expect(await partsPromise).toEqual([
        { type: "speech-start" },
        { type: "final", text: "first", segmentId: expect.any(String) },
        { type: "interim", text: "more", segmentId: expect.any(String) },
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ code: "network-error" }),
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts immediately while finish is waiting", async () => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
      }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);

    session.sendAudio(new Int16Array([1]));
    socket.message({ message_type: "partial_transcript", text: "draft" });
    const finish = Promise.resolve(session.finish());
    session.abort("cancelled");

    await expect(finish).rejects.toMatchObject({
      code: "provider-error",
      provider: "elevenlabs",
    });
    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "interim", text: "draft", segmentId: expect.any(String) },
    ]);
    expect(socket.closeReason).toBe("aborted");
  });

  it("rejects unsupported shared options before fetching a token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = elevenlabs({ tokenEndpoint: "/token", fetch });

    expect(() =>
      provider.validateOptions({ endpointing: { silenceMs: 250 } }),
    ).toThrowError(
      expect.objectContaining({
        code: "unsupported-feature",
        provider: "elevenlabs",
      }),
    );
    expect(() =>
      provider.validateOptions({ vocabulary: ["x".repeat(21)] }),
    ).toThrowError(expect.objectContaining({ code: "unsupported-feature" }));
    await expect(
      provider.doOpen({
        abortSignal: new AbortController().signal,
        endpointing: { silenceMs: 250 },
      }),
    ).rejects.toMatchObject({ code: "unsupported-feature" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes token and provider failures", async () => {
    const limited = elevenlabs({
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

    const configured = elevenlabs({
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

    const brokenBody = elevenlabs({
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
    ).rejects.toMatchObject({
      code: "token-error",
      provider: "elevenlabs",
    });

    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
      }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const reader = session.stream.getReader();
    socket.message({ message_type: "rate_limited", error: "Slow down." });

    const result = await reader.read();
    expect(result.value).toMatchObject({
      type: "error",
      error: { code: "rate-limited", provider: "elevenlabs", retryable: true },
    });
    expect(
      result.value?.type === "error" &&
        VoiceInputError.isInstance(result.value.error),
    ).toBe(true);
  });
});

describe("ElevenLabs provider conformance", () => {
  const cases = createVoiceInputProviderV1ConformanceCases({
    createHarness: createConformanceHarness,
    createAccumulatorSession: (provider, audioSource) =>
      createVoiceInputSession({ provider, audioSource }),
    errorTaxonomy: {
      createUnsupportedBrowserProvider: () =>
        elevenlabs({
          tokenEndpoint: "/token",
          fetch: vi.fn<typeof fetch>(),
          webSocket: 0 as unknown as typeof WebSocket,
        }),
      invalidOptions: { language: "not a tag" },
      malformedUnsupportedOptions: {
        vocabulary: Array.from({ length: 51 }, () => 42),
      } as unknown as VoiceTranscriptionOptions,
      unsupportedOptions: { endpointing: { silenceMs: 250 } },
    },
  });

  it.each(cases)("$name", async (testCase) => {
    await expect(testCase.run()).resolves.toBeUndefined();
  });
});

function createProvider(transport: TestTransport) {
  return elevenlabs({
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
  const waiters: Array<(value: MockWebSocket) => void> = [];
  MockWebSocket.onConstruct = (value) => {
    socket = value;
    for (const resolve of waiters.splice(0)) {
      resolve(value);
    }
  };
  return {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({ token: "sutkn_test" }),
    ),
    async waitForSocket() {
      return (
        socket ??
        (await new Promise<MockWebSocket>((resolve) => waiters.push(resolve)))
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
  static readonly CLOSED = 3;

  readonly url: URL;
  readonly json: Array<Record<string, unknown>> = [];
  readyState = MockWebSocket.CONNECTING;
  closeReason: string | undefined;
  onSend: ((value: Record<string, unknown>) => void) | undefined;

  constructor(url: string | URL) {
    super();
    this.url = new URL(url);
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
    const value = JSON.parse(data) as Record<string, unknown>;
    this.json.push(value);
    this.onSend?.(value);
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
    Object.defineProperty(event, "reason", { value: "" });
    this.dispatchEvent(event);
  }

  fail(): void {
    this.dispatchEvent(new Event("error"));
  }
}

function createConformanceHarness(): {
  provider: ReturnType<typeof elevenlabs>;
  controller: FakeVoiceInputProviderController;
} {
  const transport = createTransport();
  const provider = elevenlabs({
    tokenEndpoint: "/token",
    fetch: transport.fetch,
    webSocket: MockWebSocket as unknown as typeof WebSocket,
    finishTimeoutMs: 300,
  });
  let socket: MockWebSocket | undefined;
  let autoCommit = true;
  const getSocket = async (): Promise<MockWebSocket> => {
    socket ??= await transport.waitForSocket();
    socket.onSend = (value) => {
      if (value["commit"] === true) {
        queueMicrotask(() => {
          if (autoCommit) {
            socket?.message({
              message_type: "committed_transcript",
              text: "",
            });
          }
        });
      }
    };
    return socket;
  };
  const requireSocket = (): MockWebSocket => {
    if (socket === undefined) {
      throw new Error("The ElevenLabs test session does not exist.");
    }
    return socket;
  };
  const snapshot = (): FakeVoiceInputProviderSessionSnapshot => ({
    callOptions: { abortSignal: new AbortController().signal },
    audioChunks: Object.freeze(
      (socket?.json ?? [])
        .filter(
          (event) =>
            event["message_type"] === "input_audio_chunk" &&
            event["commit"] !== true,
        )
        .map((event) => decodeAudio(event["audio_base_64"])),
    ),
    finishCallCount: (socket?.json ?? []).some(
      (event) => event["commit"] === true,
    )
      ? 1
      : 0,
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
      if (part.type === "interim") {
        requireSocket().message({
          message_type: "partial_transcript",
          text: part.text,
        });
      } else if (part.type === "final") {
        requireSocket().message({
          message_type: "committed_transcript",
          text: part.text,
        });
      } else if (part.type === "error") {
        requireSocket().message({
          message_type: "transcriber_error",
          error: part.error.message,
        });
      }
    },
    close() {
      requireSocket().remoteClose();
    },
    fail(error) {
      requireSocket().message({
        message_type: "transcriber_error",
        error: error.message,
      });
    },
    async timeout() {
      autoCommit = false;
      await new Promise((resolve) => setTimeout(resolve, 325));
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
