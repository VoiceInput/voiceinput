import { describe, expect, it } from "vitest";

import { createLabFakeRuntime } from "./fixtures.js";

describe("lab fake runtime", () => {
  it("keeps a captured session isolated from sessions opened later", async () => {
    const runtime = createLabFakeRuntime();
    const abortController = new AbortController();
    const first = await runtime.provider.doOpen({
      abortSignal: abortController.signal,
    });
    const captured = runtime.captureCurrentSession();
    const second = await runtime.provider.doOpen({
      abortSignal: abortController.signal,
    });
    const firstReader = first.stream.getReader();
    const secondReader = second.stream.getReader();

    captured.emit({ type: "final", text: "first", segmentId: "fake:0" });
    runtime.emit({ type: "final", text: "second", segmentId: "fake:0" });

    await expect(firstReader.read()).resolves.toEqual({
      done: false,
      value: { type: "final", text: "first", segmentId: "fake:0" },
    });
    await expect(secondReader.read()).resolves.toEqual({
      done: false,
      value: { type: "final", text: "second", segmentId: "fake:0" },
    });

    captured.close();
    expect(runtime.controller.sessions[0]?.closed).toBe(true);
    expect(runtime.controller.sessions[1]?.closed).toBe(false);

    second.abort("test-complete");
    firstReader.releaseLock();
    secondReader.releaseLock();
  });
});
