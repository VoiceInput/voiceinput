import { preview } from "astro";
// Use the API so Astro's agent-aware CLI cannot detach the Playwright server.
const server = await preview({ server: { host: "127.0.0.1", port: 4322 } });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await server.stop();
    process.exit(0);
  });
}
