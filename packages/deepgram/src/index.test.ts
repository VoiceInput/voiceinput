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

import { deepgram } from "./index.js";

describe("deepgram", () => {
  it("maps shared settings, language hints, binary PCM16, results, and close semantics", async () => {
    const transport = createTransport();
    const provider = deepgram({
      tokenEndpoint: "/token",
      fetch: transport.fetch,
      webSocket: MockWebSocket as unknown as typeof WebSocket,
      numerals: true,
    });
    const sessionPromise = Promise.resolve(
      provider.doOpen({
        abortSignal: new AbortController().signal,
        language: "en-CA",
        vocabulary: ["VoiceInput", "Nova"],
        endpointing: { silenceMs: 650 },
      }),
    );
    const socket = await transport.waitForSocket();

    expect(socket.url.origin + socket.url.pathname).toBe(
      "wss://api.deepgram.com/v1/listen",
    );
    expect(socket.protocols).toEqual(["bearer", "jwt_test"]);
    expect(socket.url.searchParams.get("model")).toBe("nova-3");
    expect(socket.url.searchParams.get("encoding")).toBe("linear16");
    expect(socket.url.searchParams.get("sample_rate")).toBe("16000");
    expect(socket.url.searchParams.get("interim_results")).toBe("true");
    expect(socket.url.searchParams.get("vad_events")).toBe("true");
    expect(socket.url.searchParams.get("language")).toBe("en");
    expect(socket.url.searchParams.getAll("keyterm")).toEqual([
      "VoiceInput",
      "Nova",
    ]);
    expect(socket.url.searchParams.get("endpointing")).toBe("650");
    expect(socket.url.searchParams.get("smart_format")).toBe("true");
    expect(socket.url.searchParams.get("punctuate")).toBe("true");
    expect(socket.url.searchParams.get("numerals")).toBe("true");

    socket.open();
    const session = await sessionPromise;
    const partsPromise = readStream(session.stream);
    session.sendAudio(new Int16Array([1, -2]));
    socket.message({ type: "SpeechStarted", timestamp: 0 });
    socket.results("hel", false, false, 0);
    socket.results("hello", true, true, 0);
    session.finish();
    session.finish();
    socket.remoteClose();

    expect(await partsPromise).toEqual([
      { type: "speech-start" },
      { type: "interim", text: "hel" },
      { type: "final", text: "hello" },
      { type: "speech-end" },
    ]);
    expect(new Int16Array(socket.binary[0] as ArrayBuffer)).toEqual(
      new Int16Array([1, -2]),
    );
    expect(socket.json).toEqual([{ type: "CloseStream" }]);
  });

  it("rejects unsupported keyterm mappings before fetching a token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = deepgram({
      tokenEndpoint: "/token",
      model: "nova-2",
      fetch,
    });

    expect(() =>
      provider.validateOptions({ vocabulary: ["VoiceInput"] }),
    ).toThrowError(
      expect.objectContaining({
        code: "unsupported-feature",
        provider: "deepgram",
      }),
    );
    await expect(
      provider.doOpen({
        abortSignal: new AbortController().signal,
        vocabulary: ["VoiceInput"],
      }),
    ).rejects.toMatchObject({ code: "unsupported-feature" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses multilingual detection by default and enforces provider limits", async () => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
      }),
    );
    const socket = await transport.waitForSocket();
    expect(socket.url.searchParams.get("language")).toBe("multi");
    socket.open();
    (await sessionPromise).abort();

    const provider = createProvider(createTransport());
    expect(() =>
      provider.validateOptions({ vocabulary: ["x".repeat(101)] }),
    ).not.toThrow();
    expect(() =>
      provider.validateOptions({
        vocabulary: Array.from({ length: 501 }, () => "x"),
      }),
    ).not.toThrow();

    const monolingual = deepgram({ tokenEndpoint: "/token", model: "base" });
    expect(() => monolingual.validateOptions({})).toThrowError(
      expect.objectContaining({ code: "unsupported-feature" }),
    );
    expect(() => monolingual.validateOptions({ language: "en" })).not.toThrow();
    const medical = deepgram({
      tokenEndpoint: "/token",
      model: "nova-3-medical",
    });
    expect(() => medical.validateOptions({})).toThrowError(
      expect.objectContaining({ code: "unsupported-feature" }),
    );
  });

  it.each([
    ["nova-2", "en-CA", "en"],
    ["nova-2-general", "en-CA", "en"],
    ["nova-3", "en-CA", "en"],
    ["nova-3-general", "en-CA", "en"],
    ["nova-3", "en-GB", "en-GB"],
    ["nova-3-medical", "en-CA", "en-CA"],
  ])("maps %s language %s to %s", async (model, language, expected) => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      deepgram({
        tokenEndpoint: "/token",
        model,
        fetch: transport.fetch,
        webSocket: MockWebSocket as unknown as typeof WebSocket,
      }).doOpen({
        abortSignal: new AbortController().signal,
        language,
      }),
    );
    const socket = await transport.waitForSocket();
    expect(socket.url.searchParams.get("language")).toBe(expected);
    socket.open();
    (await sessionPromise).abort();
  });

  it("surfaces Deepgram's authoritative keyterm token rejection", async () => {
    const transport = createTransport();
    const sessionPromise = Promise.resolve(
      createProvider(transport).doOpen({
        abortSignal: new AbortController().signal,
        vocabulary: Array.from({ length: 501 }, () => "x"),
      }),
    );
    const socket = await transport.waitForSocket();
    socket.open();
    const session = await sessionPromise;
    const reader = session.stream.getReader();
    socket.message({
      type: "Error",
      code: "INVALID_QUERY_PARAMETER",
      description: "Keyterms exceed the 500-token maximum.",
    });

    await expect(reader.read()).resolves.toMatchObject({
      value: {
        type: "error",
        error: { code: "provider-error", provider: "deepgram" },
      },
    });
  });

  it("normalizes token, rate, and invalid-audio failures", async () => {
    const limited = deepgram({
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

    const configured = deepgram({
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

    const brokenBody = deepgram({
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
    ).rejects.toMatchObject({ code: "token-error", provider: "deepgram" });

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
    socket.remoteClose(1008, "DATA-0000 audio cannot be decoded");

    const result = await reader.read();
    expect(result.value).toMatchObject({
      type: "error",
      error: { code: "audio-error", provider: "deepgram", retryable: false },
    });
    expect(
      result.value?.type === "error" &&
        VoiceInputError.isInstance(result.value.error),
    ).toBe(true);
  });
});

describe("Deepgram provider conformance", () => {
  const cases = createVoiceInputProviderV1ConformanceCases({
    createHarness: createConformanceHarness,
    errorTaxonomy: {
      createUnsupportedBrowserProvider: () =>
        deepgram({
          tokenEndpoint: "/token",
          fetch: vi.fn<typeof fetch>(),
          webSocket: 0 as unknown as typeof WebSocket,
        }),
      createProvider: () =>
        deepgram({ tokenEndpoint: "/token", model: "nova-2" }),
      invalidOptions: { language: "not a tag" },
      malformedUnsupportedOptions: {
        vocabulary: [42],
      } as unknown as VoiceTranscriptionOptions,
      unsupportedOptions: { vocabulary: ["VoiceInput"] },
    },
  });

  it("passes every public provider case", async () => {
    for (const testCase of cases) {
      await expect(testCase.run()).resolves.toBeUndefined();
    }
  });
});

function createProvider(transport: TestTransport) {
  return deepgram({
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
      Response.json({ access_token: "jwt_test", expires_in: 30 }),
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
  readonly protocols: readonly string[];
  readonly json: Array<Record<string, unknown>> = [];
  readonly binary: ArrayBuffer[] = [];
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

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("Socket is not open.");
    }
    if (typeof data === "string") {
      this.json.push(JSON.parse(data) as Record<string, unknown>);
    } else {
      this.binary.push(data);
    }
  }

  message(value: Record<string, unknown>): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }

  results(
    transcript: string,
    isFinal: boolean,
    speechFinal: boolean,
    start: number,
  ): void {
    this.message({
      type: "Results",
      start,
      duration: 1,
      is_final: isFinal,
      speech_final: speechFinal,
      channel: { alternatives: [{ transcript }] },
    });
  }

  close(_code?: number, reason?: string): void {
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
  }

  remoteClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = new Event("close") as CloseEvent;
    Object.defineProperty(event, "code", { value: code });
    Object.defineProperty(event, "reason", { value: reason });
    this.dispatchEvent(event);
  }

  fail(): void {
    this.dispatchEvent(new Event("error"));
  }
}

function createConformanceHarness(): {
  provider: ReturnType<typeof deepgram>;
  controller: FakeVoiceInputProviderController;
} {
  const transport = createTransport();
  const provider = createProvider(transport);
  let socket: MockWebSocket | undefined;
  let closed = false;
  let resultStart = 0;
  const getSocket = async (): Promise<MockWebSocket> =>
    (socket ??= await transport.waitForSocket());
  const requireSocket = (): MockWebSocket => {
    if (socket === undefined) {
      throw new Error("The Deepgram test session does not exist.");
    }
    return socket;
  };
  const snapshot = (): FakeVoiceInputProviderSessionSnapshot => ({
    callOptions: { abortSignal: new AbortController().signal },
    audioChunks: Object.freeze(
      (socket?.binary ?? []).map((value) => new Int16Array(value)),
    ),
    finishCallCount: (socket?.json ?? []).filter(
      (event) => event["type"] === "CloseStream",
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
      if (closed) {
        throw new Error("Cannot emit after the Deepgram test stream closed.");
      }
      if (part.type === "speech-start") {
        requireSocket().message({ type: "SpeechStarted", timestamp: 0 });
      } else if (part.type === "speech-end") {
        requireSocket().message({ type: "UtteranceEnd", last_word_end: 1 });
      } else if (part.type === "interim") {
        requireSocket().results(part.text, false, false, resultStart);
      } else if (part.type === "final") {
        requireSocket().results(part.text, true, false, resultStart++);
      } else {
        requireSocket().message({
          type: "Error",
          code: part.error.code,
          description: part.error.message,
        });
      }
    },
    close() {
      closed = true;
      requireSocket().remoteClose();
    },
    fail(error) {
      requireSocket().message({
        type: "Error",
        code: error.code,
        description: error.message,
      });
    },
  };
  return { provider, controller };
}

async function readStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of stream) {
    values.push(value);
  }
  return values;
}
