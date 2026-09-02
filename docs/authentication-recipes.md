# Authentication and durable quotas

Every provider token handler requires `authorize`. The callback must validate
the application user from the incoming request and return a stable, non-secret
subject. Returning `null` prevents credential minting.

For cookie sessions, also compare `Origin` to a configured value and reject
`Sec-Fetch-Site: cross-site`. Do not derive the trusted origin from request host
or forwarding headers.

```ts
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

function trustedBrowserRequest(request: Request) {
  return (
    request.headers.get("origin") === appOrigin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
```

Use one of these callbacks with `createOpenAITokenHandler`,
`createElevenLabsTokenHandler`, or `createDeepgramTokenHandler`.

## Clerk in Next.js App Router

```ts
import { auth } from "@clerk/nextjs/server";

authorize: async (request) => {
  if (!trustedBrowserRequest(request)) return null;
  const { isAuthenticated, userId } = await auth();
  return isAuthenticated && userId ? { subject: userId } : null;
},
```

Install Clerk's middleware as described in its
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

Configure the Auth.js session callback to expose your database user ID; do not
use an email address or access token as the quota key.

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

Use Supabase's server client and cookie-refresh setup; `getUser()` validates the
session with the Auth server. See the official
[SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm).

## Better Auth

```ts
import { auth } from "@/lib/auth";

authorize: async (request) => {
  if (!trustedBrowserRequest(request)) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ? { subject: session.user.id } : null;
},
```

This follows Better Auth's server-side
[`getSession` API](https://better-auth.com/docs/basic-usage). Pass the incoming
headers so the library can validate its session cookie or bearer token.

## Durable Upstash quota

Create the limiter once, outside the request callback, so warm serverless
instances can reuse it. The subject namespace prevents collisions with other
application quotas.

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

The handler turns the denied result into `429` and a `Retry-After` header.
Choose limits based on credential cost and abuse risk, and decide explicitly
whether a quota-store outage should fail closed.
