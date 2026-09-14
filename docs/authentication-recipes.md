# Authentication and rate limits

Every token route must identify the caller before issuing a temporary provider
credential.

## Any session library

Start by adapting your existing session check:

```ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getCurrentUser } from "@/lib/auth"; // your existing session check

export const POST = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (!trustedBrowserRequest(request)) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});
```

Returning `null` rejects the request with `401`. Use a stable internal user ID
as `subject` so authorization, quotas, and diagnostics share one identity.

## Check the browser origin

For cookie sessions, compare `Origin` with a configured value and reject
cross-site fetches. Do not derive the trusted origin from request headers.

```ts
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

function trustedBrowserRequest(request: Request) {
  return (
    request.headers.get("origin") === appOrigin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
```

Set `APP_ORIGIN` to the exact application URL, including its development port.
The same callbacks work with the OpenAI, ElevenLabs, and Deepgram handlers.

## Clerk in Next.js App Router

```ts
import { auth } from "@clerk/nextjs/server";

authorize: async (request) => {
  if (!trustedBrowserRequest(request)) return null;
  const { isAuthenticated, userId } = await auth();
  return isAuthenticated && userId ? { subject: userId } : null;
},
```

Install Clerk middleware as described in its
[Route Handler guide](https://clerk.com/docs/reference/nextjs/app-router/route-handlers).

## Auth.js in Next.js App Router

```ts
import { auth } from "@/auth";

authorize: async (request) => {
  if (!trustedBrowserRequest(request)) return null;
  const session = await auth();
  return session?.user?.id ? { subject: session.user.id } : null;
},
```

Expose a database user ID from the Auth.js session callback. Avoid an email
address or access token as the quota key.

## Supabase in Next.js App Router

```ts
import { createClient } from "@/lib/supabase/server";

authorize: async (request) => {
  if (!trustedBrowserRequest(request)) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { subject: user.id } : null;
},
```

Use the server client and cookie-refresh setup from Supabase's
[SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm).

## Better Auth

```ts
import { auth } from "@/lib/auth";

authorize: async (request) => {
  if (!trustedBrowserRequest(request)) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ? { subject: session.user.id } : null;
},
```

Pass incoming headers to Better Auth's
[`getSession` API](https://better-auth.com/docs/basic-usage).

## Durable Upstash quota

Install a shared limiter so every server instance sees the same quota:

**npm**

```bash
npm install @upstash/ratelimit @upstash/redis
```

**pnpm**

```bash
pnpm add @upstash/ratelimit @upstash/redis
```

Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the server
environment, then create the limiter once outside the request callback:

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const voiceQuota = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "voiceinput",
});

rateLimit: async ({ subject }) => {
  const result = await voiceQuota.limit(`voice-token:${subject}`);
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
```

The handler turns a denied result into `429` with `Retry-After`. If the quota
store fails, propagate the error so the handler does not issue an unmetered
credential.
