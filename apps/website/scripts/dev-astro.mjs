import { dev } from "astro";

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
  server: { host: "127.0.0.1", port: 4321 },
  vite: { server: { strictPort: true } },
});
if (stopping) await server.stop();
