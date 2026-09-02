import { createClerkClient } from "@clerk/backend";
import { serve } from "@hono/node-server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { Hono } from "hono";

const appOrigin = new URL(required("APP_ORIGIN")).origin;
const clerk = createClerkClient({
  publishableKey: required("CLERK_PUBLISHABLE_KEY"),
  secretKey: required("CLERK_SECRET_KEY"),
});
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "voiceinput",
});
const issueVoiceToken = createOpenAITokenHandler({
  apiKey: required("OPENAI_API_KEY"),
  authorize: async (request) => {
    if (!hasTrustedOrigin(request)) return null;
    const state = await clerk.authenticateRequest(request, {
      authorizedParties: [appOrigin],
    });
    if (!state.isAuthenticated) return null;
    const { userId } = state.toAuth();
    return { subject: userId };
  },
  rateLimit: async ({ subject }) => {
    const result = await ratelimit.limit(`voice-token:${subject}`);
    return result.success
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((result.reset - Date.now()) / 1_000),
          ),
        };
  },
});

const app = new Hono();
app.post("/api/voice-token", (context) => issueVoiceToken(context.req.raw));

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8787 });

function hasTrustedOrigin(request: Request): boolean {
  return (
    request.headers.get("origin") === appOrigin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
