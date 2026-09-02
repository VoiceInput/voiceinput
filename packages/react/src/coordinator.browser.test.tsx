import { describe, expect, it, vi } from "vitest";

import {
  type CoordinatedVoiceInputSession,
  VoiceInputCoordinator,
} from "./coordinator.js";

describe("VoiceInputCoordinator", () => {
  it("waits for the active session before granting the next claim", async () => {
    const coordinator = new VoiceInputCoordinator();
    const stop = deferred();
    const first = session(() => stop.promise);
    const second = session();

    await expect(coordinator.activate(first)).resolves.toBe(true);
    const activation = coordinator.activate(second);
    let acquired = false;
    void activation.then((value) => {
      acquired = value;
    });
    await Promise.resolve();

    expect(first.stop).toHaveBeenCalledWith("replaced");
    expect(acquired).toBe(false);
    stop.resolve();
    await expect(activation).resolves.toBe(true);
  });

  it("grants only the latest rapid claim", async () => {
    const coordinator = new VoiceInputCoordinator();
    const stop = deferred();
    const first = session(() => stop.promise);
    const second = session();
    const third = session();

    await coordinator.activate(first);
    const secondActivation = coordinator.activate(second);
    const thirdActivation = coordinator.activate(third);
    await Promise.resolve();
    stop.resolve();

    await expect(secondActivation).resolves.toBe(false);
    await expect(thirdActivation).resolves.toBe(true);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).not.toHaveBeenCalled();
  });

  it("continues handoff after a bounded stop reports failure", async () => {
    const coordinator = new VoiceInputCoordinator();
    const failure = new Error("stop failed");
    const first = session(() => Promise.reject(failure));
    const second = session();
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal("reportError", reportError);

    try {
      await coordinator.activate(first);
      await expect(coordinator.activate(second)).resolves.toBe(true);
      expect(first.stop).toHaveBeenCalledOnce();
      expect(reportError).toHaveBeenCalledWith(failure);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels a pending claim when its owner unmounts", async () => {
    const coordinator = new VoiceInputCoordinator();
    const stop = deferred();
    const first = session(() => stop.promise);
    const second = session();

    await coordinator.activate(first);
    const activation = coordinator.activate(second);
    await Promise.resolve();
    coordinator.cancel(second);
    stop.resolve();

    await expect(activation).resolves.toBe(false);
  });

  it("keeps an unmounted active session owned until cleanup finishes", async () => {
    const coordinator = new VoiceInputCoordinator();
    const stop = deferred();
    const first = session(() => stop.promise);
    const second = session();

    await coordinator.activate(first);
    coordinator.cancel(first);
    const cleanup = first
      .stop("replaced")
      .then(() => coordinator.release(first));
    const activation = coordinator.activate(second);
    let acquired = false;
    void activation.then((value) => {
      acquired = value;
    });
    await Promise.resolve();

    expect(acquired).toBe(false);
    stop.resolve();
    await cleanup;
    await expect(activation).resolves.toBe(true);
  });
});

function session(
  stopImplementation: () => Promise<void> = () => Promise.resolve(),
): CoordinatedVoiceInputSession & {
  stop: ReturnType<typeof vi.fn<CoordinatedVoiceInputSession["stop"]>>;
} {
  return {
    stop: vi.fn<CoordinatedVoiceInputSession["stop"]>(stopImplementation),
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolve_) => {
    resolve = resolve_;
  });
  return { promise, resolve };
}
