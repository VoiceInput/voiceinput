import { describe, expect, it, vi } from "vitest";

import {
  type CoordinatedVoiceInputSession,
  VoiceInputCoordinator,
} from "./coordinator.js";

describe("VoiceInputCoordinator", () => {
  it("grants the next claim after initiating the active session's stop", async () => {
    const coordinator = new VoiceInputCoordinator();
    const stop = deferred();
    const first = session(() => stop.promise);
    const second = session();

    await expect(coordinator.activate(first)).resolves.toBe(true);
    const activation = coordinator.activate(second);
    await expect(activation).resolves.toBe(true);
    expect(first.stop).toHaveBeenCalledWith("replaced");
    stop.resolve();
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
      await Promise.resolve();
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
    coordinator.cancel(second);

    await expect(activation).resolves.toBe(false);
    expect(first.stop).not.toHaveBeenCalled();
    stop.resolve();
  });

  it("does not wait for an unmounted active session's cleanup", async () => {
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
    await expect(activation).resolves.toBe(true);
    stop.resolve();
    await cleanup;
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
