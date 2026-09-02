import { auth } from "@clerk/nextjs/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";

export const runtime = "nodejs";

const apiKey = required("OPENAI_API_KEY");
const appOrigin = new URL(required("APP_ORIGIN")).origin;
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "voiceinput",
});

export const POST = createOpenAITokenHandler({
  apiKey,
  authorize: async (request) => {
    if (!hasTrustedOrigin(request)) return null;
    const { isAuthenticated, userId } = await auth();
    return isAuthenticated && userId ? { subject: userId } : null;
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
