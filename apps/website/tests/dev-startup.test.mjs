import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
import { chromium } from "playwright";
import {
  runDev,
  assertPortAvailable,
  waitForBackend,
} from "../scripts/dev.mjs";
import { demoProxy } from "../scripts/demo-proxy.mjs";

const website = fileURLToPath(new URL("../", import.meta.url));
const frontend = "http://127.0.0.1:4321";
const backend = "http://127.0.0.1:4322";
const noBuild = [process.execPath, "-e", ""];

async function serve(port, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
}

async function waitForPage(signal) {
  for (let i = 0; i < 150; i++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(frontend, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* Startup is asynchronous. */
    }
    await delay(200);
  }
  throw new Error("Astro did not become ready");
}

// Run serially: the production development ports are deliberately fixed.
void test("occupied ports fail without touching the existing server", async () => {
  for (const port of [4321, 4322]) {
    const close = await serve(port, (_req, res) => res.end("existing"));
    try {
      await assert.rejects(
        runDev({ buildCommand: noBuild }),
        new RegExp(`Port ${port} is occupied`),
      );
      assert.equal(
        await (await fetch(`http://127.0.0.1:${port}`)).text(),
        "existing",
      );
    } finally {
      await close();
    }
  }
});

void test("missing configuration is actionable and readiness has a deadline", async () => {
  const close = await serve(4322, (_req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "missing-configuration" }));
  });
  try {
    await assert.rejects(
      waitForBackend(new AbortController().signal),
      /OPENAI_API_KEY.*apps\/website\/\.dev.vars/,
    );
  } finally {
    await close();
  }
  await assert.rejects(
    waitForBackend(new AbortController().signal, 100),
    /within 0.1 seconds/,
  );
});

void test("proxy failures return a sanitized development diagnostic", async () => {
  let onError;
  demoProxy.configure({
    on: (_event, listener) => {
      onError = listener;
    },
  });
  const close = await serve(4321, (req, res) =>
    onError(new Error("private detail"), req, res),
  );
  try {
    const response = await fetch(frontend);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "local-backend-unavailable");
    assert.match(body.error, /pnpm --filter @voiceinput\/website dev/);
    assert.doesNotMatch(body.error, /private detail/);
    onError(new Error(), {}, { destroy() {} }); // WebSocket socket, not HTTP.
  } finally {
    await close();
  }
});

void test("failed build and backend startup stop the launcher", async () => {
  const failure = [process.execPath, "-e", "process.exit(7)"];
  await assert.rejects(runDev({ buildCommand: failure }), /Build exited \(7\)/);
  await assert.rejects(
    runDev({ buildCommand: noBuild, workerCommand: failure }),
    /Wrangler backend exited \(7\)/,
  );
  await assertPortAvailable(4321);
  await assertPortAvailable(4322);
});

void test(
  "service crashes and SIGINT clean up both services and descendants",
  { timeout: 30_000 },
  async () => {
    for (const failure of ["backend", "frontend", "SIGINT"]) {
      const abort = new AbortController();
      const command = (port) => [
        process.execPath,
        "tests/fixtures/dev-process.mjs",
        String(port),
      ];
      const running = runDev({
        signal: abort.signal,
        buildCommand: noBuild,
        workerCommand: command(4322),
        astroCommand: command(4321),
      });
      void running.catch(() => {});
      try {
        await waitForPage(abort.signal);
        const processes = await Promise.all(
          [frontend, backend].map(async (url) => (await fetch(url)).json()),
        );
        if (failure === "SIGINT") {
          process.emit("SIGINT");
          await running;
        } else {
          await fetch(
            `${failure === "backend" ? backend : frontend}/crash`,
          ).catch(() => {});
          await assert.rejects(
            running,
            new RegExp(
              `${failure === "backend" ? "Wrangler backend" : "Astro frontend"} exited`,
            ),
          );
        }
        await assertPortAvailable(4321);
        await assertPortAvailable(4322);
        for (const entry of processes) {
          for (const pid of [entry.pid, entry.descendant]) {
            // SIGKILL delivery and reaping of orphaned grandchildren are asynchronous.
            for (let i = 0; i < 40; i++) {
              try {
                process.kill(pid, 0);
              } catch (error) {
                if (error.code === "ESRCH") break;
                throw error;
              }
              await delay(50);
            }
            assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
          }
        }
      } finally {
        abort.abort();
        await running.catch(() => {});
      }
    }
  },
);

void test("cancellation during a hanging build returns promptly", async () => {
  const abort = new AbortController();
  const running = runDev({
    signal: abort.signal,
    buildCommand: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
  });
  await delay(100);
  abort.abort();
  await running;
  await assertPortAvailable(4321);
  await assertPortAvailable(4322);
});

void test(
  "real launcher, Astro, SQLite admission and WebSocket relay survive restart",
  { timeout: 180_000 },
  async () => {
    // Isolated config and storage: no .dev.vars, real credentials, or developer quota.
    await mkdir(`${website}.wrangler`, { recursive: true });
    const directory = await mkdtemp(`${website}.wrangler/dev-test-`);
    const configPath = `${directory}/wrangler.json`;
    const parsed = ts.parseConfigFileTextToJson(
      "wrangler.jsonc",
      await readFile(`${website}wrangler.jsonc`, "utf8"),
    );
    assert.equal(parsed.error, undefined);
    const config = parsed.config;
    delete config.env;
    delete config.account_id;
    delete config.secrets;
    config.main = `${website}worker/index.ts`;
    config.assets.directory = `${website}dist`;
    config.vars.OPENAI_API_KEY = "test-fixture-only";
    config.alias = {
      "@voiceinput/openai/server": `${website}node_modules/@voiceinput/openai/dist/server.js`,
      "@voiceinput/openai": `${website}tests/dev-provider.ts`,
    };
    await writeFile(configPath, JSON.stringify(config));
    let browser;
    try {
      browser = await chromium.launch();
      for (let run = 0; run < 2; run++) {
        const abort = new AbortController();
        const running = runDev({
          signal: abort.signal,
          workerArgs: [
            "--config",
            configPath,
            "--persist-to",
            `${directory}/state`,
          ],
          // First run exercises the actual build, second checks immediate restart.
          ...(run === 1 ? { buildCommand: noBuild } : {}),
        });
        const completed = running.catch((error) => {
          abort.abort(error);
          throw error;
        });
        // Attach immediately so a startup error cannot become unhandled.
        void completed.catch(() => {});
        let page;
        try {
          await waitForPage(abort.signal);
          page = await browser.newPage();
          await page.goto(frontend);
          const result = await page.evaluate(async () => {
            const response = await fetch("/api/demo/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!response.ok)
              throw new Error(`Admission failed: ${response.status}`);
            const { ticket } = await response.json();
            return new Promise((resolve, reject) => {
              const socket = new WebSocket(
                `ws://${location.host}/api/demo/stream`,
                ["voiceinput-demo", `ticket.${ticket}`],
              );
              const events = [];
              const timeout = setTimeout(() => {
                socket.close();
                reject(new Error("Relay timed out"));
              }, 5000);
              socket.onmessage = ({ data }) => {
                const part = JSON.parse(data);
                events.push(part);
                if (part.type === "ready")
                  socket.send(new Int16Array(480).buffer);
                if (part.type === "final") socket.send('{"type":"finish"}');
              };
              socket.onclose = () => {
                clearTimeout(timeout);
                resolve(events);
              };
              socket.onerror = () => {
                clearTimeout(timeout);
                reject(new Error("WebSocket failed"));
              };
            });
          });
          assert.deepEqual(
            result.map((event) => event.type),
            ["ready", "final", "stopping", "finished"],
          );
          assert.equal(result[1].text, "Local demo transport works.");
          for (let i = 0; i < 35; i++) {
            const response = await fetch(`${backend}/api/demo/health`, {
              headers: { Origin: frontend },
            });
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { status: "ready" });
          }
          const method = await fetch(`${backend}/api/demo/health`, {
            method: "POST",
            headers: { Origin: frontend },
          });
          assert.equal(method.status, 405);
        } finally {
          await page?.close();
          abort.abort();
          await completed;
        }
        await assertPortAvailable(4321);
        await assertPortAvailable(4322);
      }
      // The same real Worker must reject missing configuration before Astro starts.
      delete config.vars.OPENAI_API_KEY;
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(
        runDev({
          buildCommand: noBuild,
          workerArgs: [
            "--config",
            configPath,
            "--persist-to",
            `${directory}/missing-state`,
          ],
        }),
        /OPENAI_API_KEY/,
      );
      await assertPortAvailable(4321);
      await assertPortAvailable(4322);
    } finally {
      await browser?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
