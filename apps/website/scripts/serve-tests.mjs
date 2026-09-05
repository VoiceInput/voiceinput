import { spawn } from "node:child_process";
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
    "4322",
    "--show-interactive-dev-session=false",
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => worker.kill(signal));
worker.once("exit", (code) => process.exit(code ?? 0));
