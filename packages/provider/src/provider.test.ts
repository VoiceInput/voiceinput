import { describe, expect, it } from "vitest";

import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceTranscriptionOptions,
} from "./index.js";
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
    fake.controller.emit({ type: "final", text: "late" });
    await expect(reader.read()).resolves.toEqual({ done: true });
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
      return createFakeVoiceInputProvider({
        autoOpen: false,
        autoCloseOnFinish: false,
      });
    },
    createAccumulatorSession: createTestAccumulatorSession,
    errorTaxonomy: {
      createProvider: createValidationProvider,
      createUnsupportedBrowserProvider() {
        const provider = createValidationProvider();
        return {
          ...provider,
          doOpen() {
            throw new VoiceInputError({
              code: "unsupported-browser",
              message: "WebSocket is unavailable.",
              provider: provider.provider,
            });
          },
        };
      },
      invalidOptions: { language: "not a tag" },
      malformedUnsupportedOptions: {
        vocabulary: [42],
      } as unknown as VoiceTranscriptionOptions,
      unsupportedOptions: { vocabulary: ["unsupported"] },
    },
  });

  it.each(cases)("$name", async (testCase) => {
    await expect(testCase.run()).resolves.toBeUndefined();
  });
});

function createValidationProvider(): VoiceInputProviderV1 {
  return createFakeVoiceInputProvider({
    validateOptions(options) {
      const vocabulary = options.vocabulary;
      if (
        options.language === "not a tag" ||
        (vocabulary !== undefined &&
          vocabulary.some((term) => typeof term !== "string"))
      ) {
        throw new VoiceInputError({
          code: "invalid-configuration",
          message: "Invalid test configuration.",
          provider: "fake",
          cause: new TypeError("Invalid portable option."),
        });
      }
      if (vocabulary?.includes("unsupported")) {
        throw new VoiceInputError({
          code: "unsupported-feature",
          message: "Unsupported test capability.",
          provider: "fake",
        });
      }
    },
  }).provider;
}

function createTestAccumulatorSession(provider: VoiceInputProviderV1) {
  const abortController = new AbortController();
  let finalTranscript = "";
  let providerSession:
    Awaited<ReturnType<VoiceInputProviderV1["doOpen"]>> | undefined;
  let consumeTask: Promise<void> | undefined;

  return {
    getSnapshot: () => ({ finalTranscript }),
    async start() {
      providerSession = await provider.doOpen({
        abortSignal: abortController.signal,
      });
      consumeTask = (async () => {
        if (providerSession === undefined) {
          return;
        }
        for await (const part of providerSession.stream) {
          if (part.type !== "final") {
            continue;
          }
          const text = part.text.trim();
          finalTranscript =
            text === ","
              ? `${finalTranscript},`
              : `${finalTranscript}${finalTranscript ? " " : ""}${text}`;
        }
      })();
    },
    async cancel() {
      abortController.abort("cancelled");
      providerSession?.abort("cancelled");
      await consumeTask;
    },
  };
}
