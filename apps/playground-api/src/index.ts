import { serve } from "@hono/node-server";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import {
  authorizeDevRequest,
  createDevAuthResponse,
  getDevAuthSecret,
  readDevAuthMode,
} from "@voiceinput/playground-auth";
import { Hono } from "hono";

const app = new Hono();

app.get("/api/health", (context) =>
  context.json({ ok: true, runtime: "hono-node" }),
);

app.post("/api/dev-auth", async (context) => {
  const mode = readDevAuthMode(await readJson(context.req.raw));
  if (mode === null) {
    return context.json(
      { error: { code: "invalid-request", message: "Invalid auth mode." } },
      400,
    );
  }
  try {
    return await createDevAuthResponse(context.req.raw, {
      mode,
      secret: getDevAuthSecret(),
    });
  } catch {
    return context.json(
      { error: { code: "fixture-disabled", message: "Fixture unavailable." } },
      403,
    );
  }
});

app.post("/api/voice-token", async (context) => {
  try {
    const secret = getDevAuthSecret();
    return await createOpenAITokenHandler({
      apiKey: readEnvironment("OPENAI_API_KEY"),
      authorize: (request) => authorizeDevRequest(request, { secret }),
    })(context.req.raw);
  } catch {
    return context.json(
      {
        error: {
          code: "fixture-unavailable",
          message: "The local token fixture is unavailable.",
        },
      },
      500,
    );
  }
});

const port = readPort(process.env["VOICEINPUT_PLAYGROUND_API_PORT"]);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close());
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is unavailable.`);
  }
  return value;
}

function readPort(value: string | undefined): number {
  const port = value === undefined ? 8787 : Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("VOICEINPUT_PLAYGROUND_API_PORT must be a valid port.");
  }
  return port;
}
