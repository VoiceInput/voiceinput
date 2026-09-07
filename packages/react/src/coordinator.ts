import type { VoiceInputStopReason } from "@voiceinput/core";
import { reportUnhandledError } from "@voiceinput/provider";

export interface CoordinatedVoiceInputSession {
  stop(reason: VoiceInputStopReason): Promise<void>;
}

export class VoiceInputCoordinator {
  #active: CoordinatedVoiceInputSession | undefined;
  #requested: CoordinatedVoiceInputSession | undefined;
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();

  activate(session: CoordinatedVoiceInputSession): Promise<boolean> {
    const generation = ++this.#generation;
    this.#requested = session;
    const activation = this.#queue.then(() => {
      if (!this.#isCurrentRequest(session, generation)) {
        return false;
      }

      const previous = this.#active;
      if (previous !== undefined && previous !== session) {
        try {
          void previous.stop("replaced").catch(reportUnhandledError);
        } catch (error) {
          reportUnhandledError(error);
        }
        if (this.#active === previous) {
          this.#active = undefined;
        }
      }

      if (!this.#isCurrentRequest(session, generation)) {
        return false;
      }
      this.#active = session;
      return true;
    });
    this.#queue = activation.then(
      () => {},
      () => {},
    );
    return activation;
  }

  release(session: CoordinatedVoiceInputSession): void {
    this.cancel(session);
    if (this.#active === session) {
      this.#active = undefined;
    }
  }

  cancel(session: CoordinatedVoiceInputSession): void {
    if (this.#requested === session) {
      this.#requested = undefined;
      this.#generation += 1;
    }
  }

  #isCurrentRequest(
    session: CoordinatedVoiceInputSession,
    generation: number,
  ): boolean {
    return this.#requested === session && this.#generation === generation;
  }
}
