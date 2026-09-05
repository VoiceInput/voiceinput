import type { Page } from "@playwright/test";

/** Synthetic microphone + mocked relay. Production always uses live OpenAI. */
export async function mockDemo(
  page: Page,
  { permissionDelayMs = 0, connectionDelayMs = 0, finishDelayMs = 0 } = {},
) {
  const stats = { audioBytes: 0 };
  await page.addInitScript(
    ({ permissionDelayMs }) => {
      const cleanup = new Map<string, () => void>();
      const nativeStop = MediaStreamTrack.prototype.stop;
      MediaStreamTrack.prototype.stop = function () {
        nativeStop.call(this);
        cleanup.get(this.id)?.();
        cleanup.delete(this.id);
        document.documentElement.dataset.microphoneStopped = "true";
      };
      Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
        configurable: true,
        value: async () => {
          if (permissionDelayMs)
            await new Promise((resolve) =>
              setTimeout(resolve, permissionDelayMs),
            );
          document.documentElement.dataset.microphoneRequests = String(
            Number(document.documentElement.dataset.microphoneRequests ?? 0) +
              1,
          );
          const context = new AudioContext();
          await context.resume();
          const source = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          source.connect(destination);
          source.start();
          const track = destination.stream.getAudioTracks()[0];
          cleanup.set(track.id, () => {
            source.stop();
            void context.close();
          });
          return destination.stream;
        },
      });
    },
    { permissionDelayMs },
  );
  await page.route("**/api/demo/session", async (route) => {
    if (connectionDelayMs)
      await new Promise((resolve) => setTimeout(resolve, connectionDelayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ticket: "00000000-0000-4000-8000-000000000001" }),
    });
  });
  await page.routeWebSocket("**/api/demo/stream", (socket) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let started = false;
    let stopped = false;
    let latest: { text: string; segmentId: string } | undefined;
    const clear = () => timers.forEach(clearTimeout);
    socket.onClose(clear);
    socket.send(JSON.stringify({ type: "ready" }));
    socket.onMessage((message) => {
      if (typeof message === "string") {
        if (message === '{"type":"finish"}' && !stopped) {
          stopped = true;
          clear();
          if (latest) socket.send(JSON.stringify({ type: "final", ...latest }));
          if (finishDelayMs)
            timers.push(
              setTimeout(
                () => socket.send(JSON.stringify({ type: "finished" })),
                finishDelayMs,
              ),
            );
          else socket.send(JSON.stringify({ type: "finished" }));
        }
        return;
      }
      stats.audioBytes += message.byteLength;
      if (started) return;
      started = true;
      ["The meeting starts at ten.", "Please bring your notes."].forEach(
        (text, phrase) => {
          const words = text.split(" ");
          words.forEach((_, index) => {
            timers.push(
              setTimeout(
                () => {
                  latest = {
                    text: words.slice(0, index + 1).join(" "),
                    segmentId: `phrase-${phrase}`,
                  };
                  const type = index === words.length - 1 ? "final" : "interim";
                  socket.send(JSON.stringify({ type, ...latest }));
                  if (type === "final") latest = undefined;
                },
                600 + phrase * 3000 + index * 350,
              ),
            );
          });
        },
      );
      timers.push(
        setTimeout(() => {
          stopped = true;
          socket.send(JSON.stringify({ type: "stopping" }));
          socket.send(JSON.stringify({ type: "finished" }));
        }, 6500),
      );
    });
  });
  return stats;
}
