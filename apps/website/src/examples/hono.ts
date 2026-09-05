import { Hono } from "hono";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { authenticateRequest, consumeVoiceQuota } from "./app-auth";

const app = new Hono();
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;
const issueToken = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (
      request.headers.get("origin") !== appOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return null;

    const user = await authenticateRequest(request);
    return user ? { subject: user.id } : null;
  },
  rateLimit: ({ subject }) => consumeVoiceQuota(subject),
});

app.post("/api/voice-token", (c) => issueToken(c.req.raw));
export default app;
