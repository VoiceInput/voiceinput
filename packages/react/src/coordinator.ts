import type { VoiceInputStopReason } from "@voiceinput/core";

export interface CoordinatedVoiceInputSession {
  stop(reason: VoiceInputStopReason): Promise<void>;
}

export class VoiceInputCoordinator {
  #active: CoordinatedVoiceInputSession | undefined;

  activate(session: CoordinatedVoiceInputSession): void {
    const previous = this.#active;
    this.#active = session;
    if (previous !== undefined && previous !== session) {
      void previous.stop("replaced").catch(reportUnhandledError);
    }
  }

  release(session: CoordinatedVoiceInputSession): void {
    if (this.#active === session) {
      this.#active = undefined;
    }
  }
}

function reportUnhandledError(error: unknown): void {
  const reportError = (
    globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    }
  ).reportError;
  reportError?.(error);
}
