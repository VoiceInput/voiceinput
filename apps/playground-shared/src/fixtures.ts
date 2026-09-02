import {
  VoiceInputError,
  type PreparedVoiceAudioSource,
  type VoiceAudioSource,
} from "@voiceinput/core";
import {
  createFakeVoiceInputProvider,
  type FakeVoiceInputProviderController,
} from "@voiceinput/provider/test";
import type {
  VoiceInputProviderV1,
  VoiceInputProviderV1Session,
  VoiceInputProviderV1StreamPart,
} from "@voiceinput/provider";

export interface LabFakeRuntime {
  readonly provider: VoiceInputProviderV1;
  readonly controller: FakeVoiceInputProviderController;
  emit(part: VoiceInputProviderV1StreamPart): void;
  close(): void;
  disconnect(): void;
  rejectNextConnection(): void;
  rejectNextToken(): void;
  rejectNextValidation(): void;
  keepNextFinishOpen(): void;
  captureCurrentSession(): LabFakeSessionControl;
}

export interface LabFakeSessionControl {
  emit(part: VoiceInputProviderV1StreamPart): void;
  close(): void;
}

export function createLabFakeRuntime(): LabFakeRuntime {
  const fake = createFakeVoiceInputProvider({
    autoOpen: false,
    autoCloseOnFinish: false,
  });
  let connectionFailure = false;
  let tokenFailure = false;
  let validationFailure = false;
  let keepFinishOpen = false;

  const provider: VoiceInputProviderV1 = {
    ...fake.provider,
    provider: "fake",
    modelId: "deterministic-lab-v1",
    validateOptions(options) {
      if (validationFailure) {
        validationFailure = false;
        throw new VoiceInputError({
          code: "unsupported-feature",
          message: "Synthetic provider does not support this lab option.",
          provider: "fake",
        });
      }
      fake.provider.validateOptions(options);
    },
    async doOpen(options) {
      const index = fake.controller.sessions.length;
      const sessionPromise = Promise.resolve(fake.provider.doOpen(options));
      await fake.controller.waitForSession(index);
      if (tokenFailure) {
        tokenFailure = false;
        fake.controller.rejectOpen(
          new VoiceInputError({
            code: "token-error",
            message: "Synthetic token request failed.",
            provider: "fake",
            retryable: true,
          }),
          index,
        );
      } else if (connectionFailure) {
        connectionFailure = false;
        fake.controller.rejectOpen(
          new VoiceInputError({
            code: "network-error",
            message: "Synthetic connection failure.",
            provider: "fake",
            retryable: true,
          }),
          index,
        );
      } else {
        fake.controller.resolveOpen(index);
      }
      const session = await sessionPromise;
      return wrapSession(session, index);
    },
  };

  const wrapSession = (
    session: VoiceInputProviderV1Session,
    index: number,
  ): VoiceInputProviderV1Session => ({
    stream: session.stream,
    sendAudio: (chunk) => session.sendAudio(chunk),
    finish() {
      session.finish();
      if (keepFinishOpen) {
        keepFinishOpen = false;
      } else {
        fake.controller.close(index);
      }
    },
    abort: (reason) => session.abort(reason),
  });

  const currentIndex = (): number => {
    const index = fake.controller.sessions.length - 1;
    if (index < 0) {
      throw new Error("Start a fake session before running this scenario.");
    }
    return index;
  };

  return {
    provider,
    controller: fake.controller,
    emit(part) {
      fake.controller.emit(part, currentIndex());
    },
    close() {
      fake.controller.close(currentIndex());
    },
    disconnect() {
      fake.controller.fail(
        new VoiceInputError({
          code: "network-error",
          message: "Synthetic provider disconnected.",
          provider: "fake",
          retryable: true,
        }),
        currentIndex(),
      );
    },
    rejectNextConnection() {
      connectionFailure = true;
    },
    rejectNextToken() {
      tokenFailure = true;
    },
    rejectNextValidation() {
      validationFailure = true;
    },
    keepNextFinishOpen() {
      keepFinishOpen = true;
    },
    captureCurrentSession() {
      const index = currentIndex();
      return {
        emit(part) {
          fake.controller.emit(part, index);
        },
        close() {
          fake.controller.close(index);
        },
      };
    },
  };
}

export function createDeterministicAudioSource(): VoiceAudioSource {
  return {
    async prepare(): Promise<PreparedVoiceAudioSource> {
      let controller: ReadableStreamDefaultController<Int16Array> | undefined;
      let closed = false;
      const stream = new ReadableStream<Int16Array>({
        start(nextController) {
          controller = nextController;
        },
      });
      const close = (): void => {
        if (!closed) {
          closed = true;
          controller?.close();
        }
      };
      return {
        stream,
        start() {
          controller?.enqueue(new Int16Array([0, 2_048, -2_048, 0]));
        },
        stop: close,
        abort: close,
      };
    },
  };
}
