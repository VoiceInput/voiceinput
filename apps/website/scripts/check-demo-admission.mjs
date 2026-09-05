// Local integration stress: the real Worker, SQLite, WebSockets, and OpenAI.
// Different trusted proxy addresses simulate independent visitors and network changes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = process.argv[2] ?? "http://127.0.0.1:4323";
assert.equal(
  new URL(origin).hostname,
  "127.0.0.1",
  "Address simulation is only for the local Worker",
);
const browser = await chromium.launch();
try {
  const pages = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const page = await browser.newPage({
        extraHTTPHeaders: { "CF-Connecting-IP": `198.51.100.${i + 1}` },
      });
      await page.goto(origin);
      const issued = await page.evaluate(async () => {
        const r = await fetch("/api/demo/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const body = await r.json();
        window.demoAdmissionTicket = body.ticket;
        return r.status;
      });
      assert.equal(issued, 200);
      await page.setExtraHTTPHeaders({
        "CF-Connecting-IP": `203.0.113.${i + 1}`,
      });
      return page;
    }),
  );
  const admitted = await Promise.all(
    pages.map((page) =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const socket = new WebSocket(
              `ws://${location.host}/api/demo/stream`,
              ["voiceinput-demo", `ticket.${window.demoAdmissionTicket}`],
            );
            window.demoAdmissionSocket = socket;
            const timer = setTimeout(() => resolve({ type: "timeout" }), 15000);
            socket.onmessage = (event) => {
              clearTimeout(timer);
              resolve(JSON.parse(event.data));
            };
          }),
      ),
    ),
  );
  assert.equal(admitted.filter((result) => result.type === "ready").length, 4);
  assert.equal(
    admitted.filter((result) => result.code === "rate-limited").length,
    4,
  );
  assert.equal(
    admitted.filter((result) => result.code === "token-error").length,
    0,
  );
  await Promise.all(
    pages.map((page) =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const socket = window.demoAdmissionSocket;
            if (socket.readyState === 3) return resolve();
            socket.addEventListener("close", () => resolve(), { once: true });
            if (socket.readyState === 1) socket.send('{"type":"finish"}');
            else socket.close();
          }),
      ),
    ),
  );
  // A busy visitor can start immediately after slots are released.
  const retryPage =
    pages[admitted.findIndex((result) => result.code === "rate-limited")];
  const restarted = await retryPage.evaluate(async () => {
    const r = await fetch("/api/demo/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return { status: r.status };
    const { ticket } = await r.json();
    return new Promise((resolve) => {
      const socket = new WebSocket(`ws://${location.host}/api/demo/stream`, [
        "voiceinput-demo",
        `ticket.${ticket}`,
      ]);
      socket.onmessage = (event) => {
        const result = JSON.parse(event.data);
        socket.close();
        resolve(result);
      };
    });
  });
  assert.equal(restarted.type, "ready");
  console.log(
    "PASS: 8 simultaneous visitors across changed IPs; 4 admitted, 4 busy, 0 token errors; immediate restart succeeds.",
  );
} finally {
  await browser.close();
}
