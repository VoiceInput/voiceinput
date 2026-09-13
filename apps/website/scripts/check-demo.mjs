// Exercises the actual landing page and relay. Only microphone input is synthetic.
// Example: node scripts/check-demo.mjs --origin https://voiceinput.dev --runs 5 --connections 20
import { DEMO_CLIENT_FINALIZATION_TIMEOUT_MS } from "../src/lib/demo-config.ts";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "playwright";

const { values } = parseArgs({
  options: {
    origin: { type: "string", default: "http://127.0.0.1:4322" },
    runs: { type: "string", default: "3" },
    connections: { type: "string", default: "0" },
    browser: { type: "string", default: "chromium" },
    "record-seconds": { type: "string" },
  },
});
const origin = new URL(values.origin).origin;
const runs = Number(values.runs);
const connections = Number(values.connections);
const recordSeconds =
  values["record-seconds"] === undefined ? 0 : Number(values["record-seconds"]);
assert(
  Number.isFinite(recordSeconds) && recordSeconds >= 0 && recordSeconds <= 19,
);
assert(Number.isInteger(runs) && runs >= 0 && runs <= 30);
assert(Number.isInteger(connections) && connections >= 0 && connections <= 100);
const engines =
  values.browser === "all"
    ? { chromium, firefox, webkit }
    : { [values.browser]: { chromium, firefox, webkit }[values.browser] };
const fixture = await readFile(
  new URL(
    "../../../fixtures/audio/librispeech-1272-128104-0014.wav",
    import.meta.url,
  ),
  "base64",
);
const results = [];

for (const [name, engine] of Object.entries(engines)) {
  assert(engine, "Choose chromium, firefox, webkit, or all");
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(
      ({ fixture, recordSeconds }) => {
        let startAudio = () => {};
        window.demoTestEvents = {
          ready: 0,
          final: 0,
          finished: 0,
          errors: [],
          texts: [],
          micRequests: 0,
          playbacks: 0,
          stops: 0,
        };
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", (event) => {
              if (typeof event.data !== "string") return;
              const part = JSON.parse(event.data);
              if (part.type in window.demoTestEvents && part.type !== "errors")
                window.demoTestEvents[part.type]++;
              if (part.type === "error")
                window.demoTestEvents.errors.push(part.message);
              if (part.type === "final")
                window.demoTestEvents.texts.push(part.text);
              if (part.type === "ready") startAudio();
            });
          }
        };
        Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
          configurable: true,
          value: async () => {
            window.demoTestEvents.micRequests++;
            const context = new AudioContext();
            await context.resume();
            const bytes = Uint8Array.from(atob(fixture), (c) =>
              c.charCodeAt(0),
            );
            const source = context.createBufferSource();
            source.buffer = await context.decodeAudioData(bytes.buffer);
            source.loop = recordSeconds > 0;
            const destination = context.createMediaStreamDestination();
            source.connect(destination);
            let started = false;
            const play = () => {
              if (!started) {
                started = true;
                window.demoTestEvents.playbacks++;
                source.start(context.currentTime + 0.15);
              }
            };
            startAudio = play;
            document.documentElement.dataset.testMicStopped = "false";
            const track = destination.stream.getAudioTracks()[0];
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              if (started) source.stop();
              if (startAudio === play) startAudio = () => {};
              window.demoTestEvents.stops++;
              void context.close();
              document.documentElement.dataset.testMicStopped = "true";
            };
            return destination.stream;
          },
        });
      },
      { fixture, recordSeconds },
    );
    await page.goto(origin);
    for (let i = 0; i < runs; i++) {
      const start = Date.now();
      const baseline = await page.evaluate(() => ({
        ...window.demoTestEvents,
      }));
      try {
        const field = page.getByRole("textbox", {
          name: "Try voice input",
          exact: true,
        });
        await field.fill("");
        await page
          .getByRole("button", { name: "Start recording", exact: true })
          .click();
        await page.waitForFunction(
          (baseline) =>
            window.demoTestEvents.micRequests > baseline.micRequests,
          baseline,
          { timeout: 2000 },
        );
        if (recordSeconds > 0) {
          await page.waitForFunction(
            (baseline) => window.demoTestEvents.ready > baseline.ready,
            baseline,
            { timeout: 15000 },
          );
          await page.waitForTimeout(recordSeconds * 1000);
        } else {
          await page.waitForFunction(
            (baseline) =>
              window.demoTestEvents.ready > baseline.ready &&
              window.demoTestEvents.final > baseline.final &&
              /Harry Quilter/i.test(
                document.querySelector("textarea")?.value ?? "",
              ),
            baseline,
            { timeout: 15000 },
          );
        }
        await page
          .getByRole("button", { name: "Stop recording", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Start recording", exact: true })
          .waitFor({ timeout: DEMO_CLIENT_FINALIZATION_TIMEOUT_MS + 2000 });
        await page.waitForFunction(
          (baseline) => window.demoTestEvents.finished > baseline.finished,
          baseline,
          { timeout: DEMO_CLIENT_FINALIZATION_TIMEOUT_MS + 2000 },
        );
        const text = await field.inputValue();
        assert.match(text, /Harry Quilter/i);
        if (recordSeconds > 0) {
          // Each complete 2.245-second loop must make it into the transcript.
          assert(
            (text.match(/Harry Quilter/gi) ?? []).length >=
              Math.floor(recordSeconds / 2.245),
            "The final transcript is missing completed speech loops",
          );
        }
        assert.equal(
          await page.locator("html").getAttribute("data-test-mic-stopped"),
          "true",
        );
        results.push({
          browser: name,
          kind: "ui-transcription",
          run: i + 1,
          ok: true,
          ms: Date.now() - start,
        });
      } catch (error) {
        results.push({
          browser: name,
          kind: "ui-transcription",
          run: i + 1,
          ok: false,
          error: String(error),
          status: await page.locator(".demo-status:visible").textContent(),
          events: await page.evaluate(() => window.demoTestEvents),
          value: await page
            .getByRole("textbox", { name: "Try voice input", exact: true })
            .inputValue(),
        });
        await page.reload();
      }
      console.log(JSON.stringify(results.at(-1)));
    }
    // Empty connections stress admission, network changes, and slot cleanup without spending audio quota.
    for (let i = 0; i < connections; i++) {
      const result = await page.evaluate(async () => {
        const start = Date.now();
        const response = await fetch("/api/demo/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok)
          return {
            ok: false,
            status: response.status,
            error: await response.text(),
          };
        const { ticket } = await response.json();
        return new Promise((resolve) => {
          const events = [];
          const url = new URL("/api/demo/stream", location.href);
          url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
          const socket = new WebSocket(url, [
            "voiceinput-demo",
            `ticket.${ticket}`,
          ]);
          const timer = setTimeout(() => {
            socket.close();
            resolve({ ok: false, error: "timeout", events });
          }, 15000);
          socket.addEventListener("message", (event) => {
            const part = JSON.parse(event.data);
            events.push(part.type);
            if (part.type === "ready") socket.send('{"type":"finish"}');
          });
          socket.addEventListener("close", (event) => {
            clearTimeout(timer);
            resolve({
              ok:
                events.join(",") === "ready,stopping,finished" &&
                event.code === 1000,
              events,
              ms: Date.now() - start,
            });
          });
        });
      });
      results.push({
        browser: name,
        kind: "connection",
        run: i + 1,
        ...result,
      });
      console.log(JSON.stringify(results.at(-1)));
      await new Promise((resolve) => setTimeout(resolve, 2200));
    }
  } finally {
    await browser.close();
  }
}
const output = new URL(
  `../../../output/playwright/demo-reliability-${new URL(origin).hostname}-${values.browser}${recordSeconds ? `-${recordSeconds}s` : ""}.json`,
  import.meta.url,
);
await mkdir(new URL(".", output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ origin, at: new Date().toISOString(), results }, null, 2) +
    "\n",
);
console.log(
  `Passed ${results.filter((r) => r.ok).length}/${results.length}; results: ${output.pathname}`,
);
if (results.some((r) => !r.ok)) process.exitCode = 1;
