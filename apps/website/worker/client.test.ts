import { afterEach, expect, test, vi } from "vitest";
import { liveDemo } from "../src/lib/live-demo";

afterEach(() => vi.unstubAllGlobals());

test("session errors preserve the server reason and retry delay", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: "The demo is busy." },
          { status: 429, headers: { "Retry-After": "60" } },
        ),
      ),
  );
  await expect(
    liveDemo(() => {}).doOpen({ abortSignal: new AbortController().signal }),
  ).rejects.toMatchObject({
    code: "rate-limited",
    retryAfterMs: 60_000,
    message: "The demo is busy. You can retry in 1 minute.",
  });
});

test("non-JSON gateway failures retain a useful fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Bad gateway", { status: 502 })),
  );
  await expect(
    liveDemo(() => {}).doOpen({ abortSignal: new AbortController().signal }),
  ).rejects.toMatchObject({
    code: "network-error",
    message: "The voice demo is unavailable right now. Please try again later.",
  });
});

test("WebSocket busy messages retain their error code and release the socket", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ticket: "00000000-0000-4000-8000-000000000001" }),
      ),
  );
  vi.stubGlobal("location", {
    href: "https://voiceinput.dev/",
    protocol: "https:",
  });
  const close = vi.fn<() => void>();
  class Socket extends EventTarget {
    close = close;
    constructor() {
      super();
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "error",
              code: "rate-limited",
              message: "The demo is busy.",
              retryAfterMs: 60_000,
            }),
          }),
        ),
      );
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  await expect(
    liveDemo(() => {}).doOpen({ abortSignal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: "rate-limited", retryAfterMs: 60_000 });
  expect(close).toHaveBeenCalledOnce();
});

function retryFixture(messages: Record<string, unknown>[]) {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ ticket: crypto.randomUUID() }),
    );
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("location", {
    href: "https://voiceinput.dev/",
    protocol: "https:",
  });
  const sockets: Socket[] = [];
  class Socket extends EventTarget {
    close = vi.fn<() => void>();
    constructor() {
      super();
      const message = messages[sockets.length] ?? messages.at(-1)!;
      sockets.push(this);
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", { data: JSON.stringify(message) }),
        ),
      );
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  return { request, sockets };
}

test("an expired startup ticket is replaced once before audio is sent", async () => {
  const { request, sockets } = retryFixture([
    {
      type: "error",
      code: "token-error",
      message: "Start a new demo session.",
    },
    { type: "ready" },
  ]);
  const session = await liveDemo(() => {}).doOpen({
    abortSignal: new AbortController().signal,
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(sockets[0]!.close).toHaveBeenCalledOnce();
  session.abort();
});

test("repeated startup errors stop after one retry", async () => {
  const { request } = retryFixture([
    {
      type: "error",
      code: "token-error",
      message: "Start a new demo session.",
    },
  ]);
  await expect(
    liveDemo(() => {}).doOpen({ abortSignal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: "token-error" });
  expect(request).toHaveBeenCalledTimes(2);
});

test("busy connections do not automatically retry", async () => {
  const { request } = retryFixture([
    { type: "error", code: "rate-limited", message: "Busy" },
  ]);
  await expect(
    liveDemo(() => {}).doOpen({ abortSignal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: "rate-limited" });
  expect(request).toHaveBeenCalledOnce();
});

test("a recording failure never reconnects or replays audio", async () => {
  const { request, sockets } = retryFixture([{ type: "ready" }]);
  const session = await liveDemo(() => {}).doOpen({
    abortSignal: new AbortController().signal,
  });
  sockets[0]!.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({
        type: "error",
        message: "Connection interrupted",
      }),
    }),
  );
  const reader = session.stream.getReader();
  expect((await reader.read()).value?.type).toBe("error");
  expect((await reader.read()).done).toBe(true);
  expect(request).toHaveBeenCalledOnce();
});

test("a premature finished event rejects instead of leaving startup pending", async () => {
  const { request } = retryFixture([{ type: "finished" }]);
  await expect(
    liveDemo(() => {}).doOpen({ abortSignal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: "token-error" });
  expect(request).toHaveBeenCalledTimes(2);
});
