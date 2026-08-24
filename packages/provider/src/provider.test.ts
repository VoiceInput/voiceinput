import { describe, expect, it } from "vitest";

import { VoiceInputError } from "./index.js";
import {
  createFakeVoiceInputProvider,
  createVoiceInputProviderV1ConformanceCases,
} from "./test.js";

describe("VoiceInputError", () => {
  it("retains normalized metadata and supports marker-based detection", () => {
    const cause = new Error("provider payload");
    const error = new VoiceInputError({
      code: "rate-limited",
      message: "Try again later.",
      provider: "fake",
      retryable: true,
      retryAfterMs: 2_000,
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("rate-limited");
    expect(error.provider).toBe("fake");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2_000);
    expect(VoiceInputError.isInstance(error)).toBe(true);
    expect(VoiceInputError.isInstance(new Error("other"))).toBe(false);
  });
});

describe("createFakeVoiceInputProvider", () => {
  it("supports manually controlled opening and stream delivery", async () => {
    const fake = createFakeVoiceInputProvider({
      autoOpen: false,
      autoCloseOnFinish: false,
    });
    const openPromise = Promise.resolve(
      fake.provider.doOpen({
        abortSignal: new AbortController().signal,
        language: "en-CA",
      }),
    );

    const inspection = await fake.controller.waitForSession();
    expect(inspection.callOptions.language).toBe("en-CA");
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(fake.controller.sessions)).toBe(true);

    fake.controller.resolveOpen();
    const session = await openPromise;
    const reader = session.stream.getReader();
    fake.controller.emit({ type: "interim", text: "hello" });
    fake.controller.close();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: "interim", text: "hello" },
    });
    await expect(reader.read()).resolves.toEqual({ done: true });
    expect(() => {
      fake.controller.emit({ type: "final", text: "late" });
    }).toThrow("after the fake provider stream closed");
  });

  it("rejects a pending open when its abort signal fires", async () => {
    const fake = createFakeVoiceInputProvider({ autoOpen: false });
    const abortController = new AbortController();
    const openPromise = Promise.resolve(
      fake.provider.doOpen({ abortSignal: abortController.signal }),
    );
    await fake.controller.waitForSession();

    abortController.abort("cancelled");

    await expect(openPromise).rejects.toBe("cancelled");
    expect(fake.controller.sessions[0]).toMatchObject({
      aborted: true,
      abortCallCount: 1,
      closed: true,
    });
  });
});

describe("VoiceInputProviderV1 conformance", () => {
  const cases = createVoiceInputProviderV1ConformanceCases({
    createHarness() {
      return createFakeVoiceInputProvider({ autoOpen: false });
    },
  });

  it("passes all framework-neutral conformance cases", async () => {
    for (const testCase of cases) {
      await expect(testCase.run()).resolves.toBeUndefined();
    }
  });
});
