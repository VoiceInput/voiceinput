import { dev } from "astro";

const port = Number(process.argv[2] ?? 4321);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError("The Astro development port must be a valid TCP port.");
}

// Astro's CLI automatically detaches in agent environments. Use its API so the
// frontend stays in the launcher's process group and can always be supervised.
let stopping = false;
let server;
const stop = async () => {
  stopping = true;
  await server?.stop();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
server = await dev({
  root: new URL("../", import.meta.url),
  server: { host: "127.0.0.1", port },
  vite: { server: { strictPort: true } },
});
if (stopping) await server.stop();
