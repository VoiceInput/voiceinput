import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserAudioSource,
  getBrowserVoiceInputSupport,
  normalizeBrowserAudioError,
} from "./browser-audio.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser support", () => {
  it("reports every missing capability without throwing", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    vi.stubGlobal("AudioWorkletNode", undefined);

    expect(getBrowserVoiceInputSupport()).toEqual({
      isSupported: false,
      missingCapabilities: ["secure-context", "media-devices", "audio-context"],
    });
  });

  it("rejects invalid frame durations at configuration time", () => {
    expect(() => createBrowserAudioSource({ frameDurationMs: 0 })).toThrow(
      /frameDurationMs/,
    );
  });
});

describe("browser audio errors", () => {
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["NotFoundError", "device-not-found"],
    ["NotReadableError", "device-busy"],
    ["UnknownError", "audio-error"],
  ])("normalizes %s", (name, code) => {
    const cause = new DOMException("failure", name);
    const error = normalizeBrowserAudioError(cause);

    expect(error.code).toBe(code);
    expect(error.cause).toBe(cause);
  });
});

describe("browser audio lifecycle", () => {
  it("releases acquired resources when post-permission setup stalls", async () => {
    const track = new FakeTrack();
    const mediaStream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    let markModuleStarted: () => void = () => {};
    const moduleStarted = new Promise<void>((resolve) => {
      markModuleStarted = resolve;
    });
    class HangingAudioContext extends FakeAudioContext {
      override get audioWorklet(): AudioWorklet {
        return {
          addModule: (url: string) => {
            this.moduleUrls.push(url);
            markModuleStarted();
            return new Promise<void>(() => {});
          },
        } as AudioWorklet;
      }
    }
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => mediaStream },
      userActivation: { isActive: true },
    });
    vi.stubGlobal("AudioContext", HangingAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
    const abortController = new AbortController();
    const onAcquired = vi.fn<() => void>();
    const source = createBrowserAudioSource();

    void source.prepare({
      sampleRate: 16_000,
      abortSignal: abortController.signal,
      onAcquired,
    });
    await moduleStarted;
    expect(onAcquired).toHaveBeenCalledOnce();
    abortController.abort("connection-timeout");
    await Promise.resolve();

    expect(track.stopCallCount).toBe(1);
    expect(HangingAudioContext.instance?.closeCallCount).toBe(1);
  });

  it("resumes Safari-style suspended contexts and tears everything down", async () => {
    const track = new FakeTrack();
    const mediaStream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    const getUserMedia = vi.fn<() => Promise<typeof mediaStream>>(async () =>
      Promise.resolve(mediaStream),
    );
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      userActivation: { isActive: true },
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);

    const source = createBrowserAudioSource({
      constraints: { echoCancellation: false },
      frameDurationMs: 40,
    });
    const prepared = await source.prepare({
      sampleRate: 16_000,
      abortSignal: new AbortController().signal,
    });
    const context = FakeAudioContext.instance;
    const worklet = FakeAudioWorkletNode.instance;

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: false },
      video: false,
    });
    expect(context?.resumeCallCount).toBe(1);
    expect(context?.options.sampleRate).toBe(16_000);
    expect(context?.moduleUrls[0]).toMatch(/^blob:/);
    expect(worklet?.options.processorOptions).toEqual({
      frameSamples: 640,
      targetSampleRate: 16_000,
    });

    await prepared.start();
    expect(context?.source.connected).toBe(true);

    const reader = prepared.stream.getReader();
    const samples = new Int16Array([1, -2, 3]);
    worklet?.port.onmessage?.(
      new MessageEvent("message", { data: samples.buffer }),
    );
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: samples,
    });

    await prepared.stop();
    await prepared.stop();
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(track.stopCallCount).toBe(1);
    expect(context?.closeCallCount).toBe(1);
    expect(context?.source.disconnected).toBe(true);
    expect(worklet?.port.closed).toBe(true);
  });

  it("requires a user gesture before requesting microphone access", async () => {
    const getUserMedia = vi.fn<() => void>();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      userActivation: { isActive: false },
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);

    const source = createBrowserAudioSource();
    await expect(
      source.prepare({
        sampleRate: 16_000,
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("stops a microphone that arrives after cancellation", async () => {
    const track = new FakeTrack();
    const mediaStream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    let resolvePermission: (stream: typeof mediaStream) => void = () => {};
    const permission = new Promise<typeof mediaStream>((resolve) => {
      resolvePermission = resolve;
    });
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => permission },
      userActivation: { isActive: true },
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);

    const abortController = new AbortController();
    const prepare = createBrowserAudioSource().prepare({
      sampleRate: 16_000,
      abortSignal: abortController.signal,
    });
    abortController.abort();
    resolvePermission(mediaStream);

    await expect(prepare).rejects.toMatchObject({ code: "device-busy" });
    expect(track.stopCallCount).toBe(1);
  });

  it("errors the stream when the processor fails", async () => {
    const track = new FakeTrack();
    stubSupportedBrowser(track);
    const prepared = await createBrowserAudioSource().prepare({
      sampleRate: 16_000,
      abortSignal: new AbortController().signal,
    });
    const reader = prepared.stream.getReader();

    FakeAudioWorkletNode.instance?.dispatchProcessorError();

    await expect(reader.read()).rejects.toMatchObject({ code: "audio-error" });
    expect(track.stopCallCount).toBe(1);
  });

  it("errors the stream if the microphone ends while connecting", async () => {
    const track = new FakeTrack();
    stubSupportedBrowser(track);
    const prepared = await createBrowserAudioSource().prepare({
      sampleRate: 16_000,
      abortSignal: new AbortController().signal,
    });
    const reader = prepared.stream.getReader();

    track.dispatchEnded();

    await expect(reader.read()).rejects.toMatchObject({ code: "audio-error" });
  });
});

class FakeTrack {
  stopCallCount = 0;
  endedListener: (() => void) | undefined;

  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") {
      this.endedListener = listener;
    }
  }

  dispatchEnded(): void {
    this.endedListener?.();
  }

  stop(): void {
    this.stopCallCount += 1;
  }
}

class FakeAudioNode {
  connected = false;
  disconnected = false;

  connect(): FakeAudioNode {
    this.connected = true;
    return this;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeAudioContext {
  static instance: FakeAudioContext | undefined;

  readonly destination = {};
  readonly moduleUrls: string[] = [];
  readonly source = new FakeAudioNode();
  readonly gain = Object.assign(new FakeAudioNode(), { gain: { value: 1 } });
  state: AudioContextState = "suspended";
  resumeCallCount = 0;
  closeCallCount = 0;

  constructor(readonly options: AudioContextOptions = {}) {
    FakeAudioContext.instance = this;
  }

  get audioWorklet(): AudioWorklet {
    return {
      addModule: async (url: string) => {
        this.moduleUrls.push(url);
      },
    } as AudioWorklet;
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return this.source as unknown as MediaStreamAudioSourceNode;
  }

  createGain(): GainNode {
    return this.gain as unknown as GainNode;
  }

  async resume(): Promise<void> {
    this.resumeCallCount += 1;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCallCount += 1;
    this.state = "closed";
  }
}

class FakeMessagePort {
  closed = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;

  close(): void {
    this.closed = true;
  }

  postMessage(message: unknown): void {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "flush"
    ) {
      queueMicrotask(() =>
        this.onmessage?.(createMessage({ type: "flushed" })),
      );
    }
  }
}

class FakeAudioWorkletNode extends FakeAudioNode {
  static instance: FakeAudioWorkletNode | undefined;

  readonly port = new FakeMessagePort();
  processorErrorListener: ((event: Event) => void) | undefined;

  constructor(
    _context: unknown,
    _name: string,
    readonly options: AudioWorkletNodeOptions,
  ) {
    super();
    FakeAudioWorkletNode.instance = this;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (type === "processorerror") {
      this.processorErrorListener = listener;
    }
  }

  dispatchProcessorError(): void {
    this.processorErrorListener?.(new Event("processorerror"));
  }
}

function createMessage(data: unknown): MessageEvent<unknown> {
  return { data } as MessageEvent<unknown>;
}

function stubSupportedBrowser(track: FakeTrack): void {
  const mediaStream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => Promise.resolve(mediaStream) },
    userActivation: { isActive: true },
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
}
