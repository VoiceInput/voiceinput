import { Hono } from "hono";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getCurrentUser } from "./app-auth";

const app = new Hono();
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;
const issueToken = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});

app.post("/api/voice-token", (c) => issueToken(c.req.raw));
export default app;
