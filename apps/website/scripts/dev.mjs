import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const website = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "http://127.0.0.1:4321";
const backend = "http://127.0.0.1:4322";

export async function assertPortAvailable(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop the existing server, then run pnpm --filter @voiceinput/website dev again.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}

export async function waitForBackend(signal, timeoutMs = 30_000) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let failure = "The local demo backend did not become ready";
  while (!deadline.aborted) {
    try {
      const response = await fetch(`${backend}/api/demo/health`, {
        headers: { Origin: origin },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(1000)]),
      });
      const body = await response.json();
      if (response.ok && body.status === "ready") return;
      if (body.code === "missing-configuration") {
        throw new MissingConfigurationError();
      }
      failure =
        "The local demo backend could not access its Durable Object storage";
    } catch (error) {
      if (error instanceof MissingConfigurationError) throw error;
    }
    try {
      await delay(200, undefined, { signal: deadline });
    } catch {
      break;
    }
  }
  signal.throwIfAborted();
  throw new Error(
    `${failure} within ${timeoutMs / 1000} seconds. Check the Wrangler output above and restart development.`,
  );
}

class MissingConfigurationError extends Error {
  constructor() {
    super(
      "The local demo needs OPENAI_API_KEY. Set it in apps/website/.dev.vars, then restart pnpm --filter @voiceinput/website dev. Never put the key in browser code.",
    );
  }
}

// Commands can be supplied by integration tests; the CLI always uses the real services.
export async function runDev({
  signal,
  workerArgs = [],
  buildCommand = [
    "pnpm",
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@voiceinput/website",
    "--output-logs=errors-only",
  ],
  workerCommand = [
    "pnpm",
    "exec",
    "wrangler",
    "dev",
    "--env=",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "4322",
    "--inspector-port",
    "0",
    "--show-interactive-dev-session=false",
    "--types=false",
    ...workerArgs,
  ],
  astroCommand = [process.execPath, "scripts/dev-astro.mjs"],
  readinessTimeoutMs = 30_000,
  stdio = "inherit",
} = {}) {
  const abort = new AbortController();
  const children = [];
  const stopped = new Promise((resolve) => {
    abort.signal.addEventListener("abort", resolve, { once: true });
  });
  const onSignal = () => abort.abort();
  const onExternalAbort = () => abort.abort(signal.reason);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (signal?.aborted) onExternalAbort();

  const launch = (name, command, cwd, persistent) => {
    abort.signal.throwIfAborted();
    const child = spawn(command[0], command.slice(1), {
      cwd,
      stdio,
      detached: process.platform !== "win32",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    const exited = new Promise((resolve) => {
      child.once("error", () => {
        abort.abort(
          new Error(
            `${name} could not start. Check that pnpm and dependencies are installed.`,
          ),
        );
        resolve();
      });
      child.once("exit", (code, childSignal) => {
        if (!abort.signal.aborted && (persistent || code !== 0)) {
          abort.abort(
            new Error(
              `${name} exited (${childSignal ?? code}). Both development services have been stopped. Fix the error above, then restart development.`,
            ),
          );
        }
        resolve();
      });
    });
    children.push({ child, exited });
    return exited;
  };

  try {
    abort.signal.throwIfAborted();
    await assertPortAvailable(4321);
    await assertPortAvailable(4322);
    console.log(
      "[website dev] Building workspace dependencies and website assets…",
    );
    await Promise.race([launch("Build", buildCommand, root, false), stopped]);
    abort.signal.throwIfAborted();
    // Recheck after building: another process may have claimed a port meanwhile.
    await assertPortAvailable(4321);
    await assertPortAvailable(4322);
    void launch("Wrangler backend", workerCommand, website, true);
    await waitForBackend(abort.signal, readinessTimeoutMs);
    void launch("Astro frontend", astroCommand, website, true);
    console.log(
      `[website dev] Demo backend ready. Astro is starting at ${origin}.`,
    );
    await stopped;
    abort.signal.throwIfAborted();
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
  } finally {
    abort.abort();
    try {
      await stopChildren(children);
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function stopChildren(children) {
  const cleanup = await Promise.allSettled(children.map(stopProcessTree));
  const failed = cleanup.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

async function stopProcessTree({ child, exited }) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        { stdio: "ignore" },
      );
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    return;
  }
  const kill = (signal) => {
    try {
      // Kill the group, including pnpm's Wrangler/Astro/workerd descendants.
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  if (!kill("SIGTERM")) return;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      // A permission error from the existence probe does not prove the group
      // exited. Keep waiting; an actual signaling failure is still reported.
      if (error.code !== "EPERM") throw error;
    }
    await delay(50);
  }
  kill("SIGKILL");
  await exited;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runDev().catch((error) => {
    console.error(`[website dev] ${error.message}`);
    process.exitCode = 1;
  });
}
