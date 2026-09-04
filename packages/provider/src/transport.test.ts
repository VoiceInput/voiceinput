import { afterEach, expect, it, vi } from "vitest";
import { sendWithBackpressure } from "./transport.js";

afterEach(() => vi.useRealTimers());

it("sends immediately on a clear connection and waits during congestion", async () => {
  vi.useFakeTimers();
  const socket = { readyState: 1, bufferedAmount: 0 };
  const send = vi.fn<() => void>();
  const signal = new AbortController().signal;
  expect(
    sendWithBackpressure(socket, 640, signal, "test", send),
  ).toBeUndefined();
  socket.bufferedAmount = 1024 * 1024;
  const pending = sendWithBackpressure(socket, 640, signal, "test", send);
  expect(send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(50);
  expect(send).toHaveBeenCalledOnce();
  socket.bufferedAmount = 0;
  await vi.advanceTimersByTimeAsync(25);
  await pending;
  expect(send).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["timeout", "abort", "close"])(
  "cleans up a congested send on %s",
  async (cause) => {
    vi.useFakeTimers();
    const socket = { readyState: 1, bufferedAmount: 1024 * 1024 };
    const controller = new AbortController();
    const send = vi.fn<() => void>();
    const outcome = Promise.resolve(
      sendWithBackpressure(socket, 640, controller.signal, "test", send),
    ).catch((error) => error);
    if (cause === "abort") controller.abort();
    if (cause === "close") socket.readyState = 3;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await outcome).toMatchObject({
      code: "network-error",
      retryable: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);
