import { spawn } from "node:child_process";

const frontendEnvironment = { ...process.env };
for (const name of [
  "OPENAI_API_KEY",
  "DEEPGRAM_API_KEY",
  "ELEVENLABS_API_KEY",
]) {
  delete frontendEnvironment[name];
}
frontendEnvironment["VOICEINPUT_PLAYGROUND_API_ORIGIN"] =
  "http://127.0.0.1:8789";

const child = spawn(
  "pnpm",
  [
    "--filter",
    "@voiceinput/playground-vite",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "5175",
    "--strictPort",
  ],
  { env: frontendEnvironment, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
