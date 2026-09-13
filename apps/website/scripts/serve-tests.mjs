import { spawn } from "node:child_process";

const port = Number(process.env["VOICEINPUT_WEBSITE_TEST_PORT"] ?? 14322);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError("VOICEINPUT_WEBSITE_TEST_PORT must be a valid TCP port.");
}
const worker = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--env=",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--show-interactive-dev-session=false",
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => worker.kill(signal));
worker.once("exit", (code) => process.exit(code ?? 0));
