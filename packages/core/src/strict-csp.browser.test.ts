import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { createBrowserAudioSource } from "./browser-audio.js";

describe("strict CSP AudioWorklet", () => {
  it("captures microphone audio from a same-origin module while Blob modules are blocked", async () => {
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content =
      "default-src 'self'; script-src 'self'; script-src-elem 'self'; connect-src 'self' ws:; object-src 'none'";
    document.head.append(policy);

    const blockedContext = new AudioContext();
    const blockedUrl = URL.createObjectURL(
      new Blob(
        [
          'registerProcessor("blocked-by-csp", class extends AudioWorkletProcessor { process() { return false; } });',
        ],
        { type: "text/javascript" },
      ),
    );
    try {
      await expect(
        blockedContext.audioWorklet.addModule(blockedUrl),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      URL.revokeObjectURL(blockedUrl);
      await blockedContext.close();
    }
    const button = document.createElement("button");
    button.textContent = "Start microphone";
    document.body.append(button);
    const frame = new Promise<Int16Array>((resolve, reject) => {
      button.addEventListener(
        "click",
        () => {
          void captureFrame().then(resolve, reject);
        },
        { once: true },
      );
    });

    await userEvent.click(button);
    const samples = await frame;

    expect(samples).toHaveLength(160);
    button.remove();
  });
});

async function captureFrame(): Promise<Int16Array> {
  const source = createBrowserAudioSource({
    frameDurationMs: 10,
    workletModuleUrl: "/voiceinput-worklet.js",
  });
  const prepared = await source.prepare({
    sampleRate: 16_000,
    abortSignal: new AbortController().signal,
  });
  prepared.start();
  const reader = prepared.stream.getReader();
  let value: Int16Array | undefined;
  try {
    ({ value } = await reader.read());
  } finally {
    reader.releaseLock();
    await prepared.stop();
  }
  if (value === undefined) {
    throw new Error("The microphone stream ended before producing audio.");
  }
  return value;
}
