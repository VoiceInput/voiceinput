import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  VoiceInputProviderV1,
  VoiceInputProviderV1StreamPart,
} from "@voiceinput/provider";
import { relaySession } from "./relay";
import { MAX_AUDIO_BYTES, MAX_FRAME_BYTES } from "./limits";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
class TestSocket extends EventTarget {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  message(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
async function setup(hangOnFinish = false) {
  const socket = new TestSocket();
  let controller!: ReadableStreamDefaultController<VoiceInputProviderV1StreamPart>;
  let closed = false;
  const end = () => {
    if (!closed) {
      closed = true;
      controller.close();
    }
  };
  const session = {
    stream: new ReadableStream<VoiceInputProviderV1StreamPart>({
      start(value) {
        controller = value;
      },
    }),
    sendAudio: vi.fn<(chunk: Int16Array) => void>(),
    finish: vi.fn<() => void>(() => {
      if (!hangOnFinish) end();
    }),
    abort: vi.fn<() => void>(end),
  };
  const provider: VoiceInputProviderV1 = {
    specificationVersion: "v1",
    provider: "test",
    modelId: "test",
    sampleRate: 24_000,
    validateOptions() {},
    doOpen: async () => session,
  };
  const done = relaySession(socket as WebSocket, provider);
  await Promise.resolve();
  return { socket, session, done, controller };
}

test("a client cannot extend the recording beyond 20 seconds", async () => {
  const { socket, session, done } = await setup();
  await vi.advanceTimersByTimeAsync(20_000);
  await done;
  expect(session.finish).toHaveBeenCalledTimes(1);
  expect(socket.sent.map((part) => part.type)).toEqual([
    "ready",
    "stopping",
    "finished",
  ]);
  expect(session.abort).toHaveBeenCalled();
});

test("faster-than-realtime uploads cannot exceed the audio budget", async () => {
  const { socket, session, done } = await setup();
  for (let offset = 0; offset < MAX_AUDIO_BYTES; offset += 48_000) {
    socket.message(new ArrayBuffer(Math.min(48_000, MAX_AUDIO_BYTES - offset)));
    await vi.advanceTimersByTimeAsync(0);
  }
  socket.message(new ArrayBuffer(48_000));
  await done;
  const bytes = session.sendAudio.mock.calls.reduce(
    (sum, [chunk]) => sum + chunk.byteLength,
    0,
  );
  expect(bytes).toBe(MAX_AUDIO_BYTES);
  expect(session.finish).toHaveBeenCalledTimes(1);
});

test.each([
  new ArrayBuffer(MAX_FRAME_BYTES + 2),
  new ArrayBuffer(3),
  '{"type":"session.update","model":"other"}',
])(
  "rejects invalid audio or configuration instead of forwarding it",
  async (data) => {
    const { socket, session, done } = await setup();
    socket.message(data);
    await done;
    expect(session.sendAudio).not.toHaveBeenCalled();
    expect(session.abort).toHaveBeenCalled();
    expect(socket.sent.at(-1)?.type).toBe("error");
  },
);

test("a stalled finalization cannot keep the provider connected indefinitely", async () => {
  const { socket, session, done } = await setup(true);
  socket.message('{"type":"finish"}');
  await vi.advanceTimersByTimeAsync(10_000);
  await done;
  expect(session.abort).toHaveBeenCalled();
  expect(socket.sent.at(-1)?.type).toBe("error");
});

test("closing the browser immediately aborts the upstream session", async () => {
  const { socket, session, done } = await setup();
  socket.close();
  await done;
  expect(session.abort).toHaveBeenCalledTimes(1);
});

test("only a ready provider commits a recording reservation", async () => {
  const ready = vi.fn<() => void>();
  const provider: VoiceInputProviderV1 = {
    specificationVersion: "v1",
    provider: "test",
    modelId: "test",
    sampleRate: 24000,
    validateOptions() {},
    doOpen: async () => {
      throw new Error("connection failed");
    },
  };
  const socket = new TestSocket();
  await relaySession(socket as WebSocket, provider, ready);
  expect(ready).not.toHaveBeenCalled();
  expect(socket.sent.at(-1)?.type).toBe("error");
  expect(socket.readyState).toBe(3);
});
