import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getCurrentUser } from "./app-auth"; // your existing session check

export const runtime = "nodejs";
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

export const POST = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});
