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
