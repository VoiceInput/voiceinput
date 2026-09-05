# Authentication and rate limits

Your token route must check who is asking for a credential. The required
`authorize` callback validates the signed-in user and returns their stable user
ID as `subject`. Returning `null` rejects the request without issuing a token.

These recipes assume your chosen sign-in library is already configured. The
`@/auth`, `@/lib/auth`, and Supabase server-client imports refer to your app’s
existing auth setup; they are not VoiceInput exports. For a complete example,
start with the [quickstart](quickstart.md) or
[example projects](golden-paths.md).

## Where the callbacks go

Choose one auth recipe below and add its `authorize` callback to your provider
handler. Add a `rateLimit` callback if you want to limit credential requests.
This is the surrounding route structure; the auth helper is supplied by your
app:

```ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { authorize } from "./voice-auth";

export const POST = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize,
});
```

For that structure, export the chosen callback as `authorize` from
`voice-auth.ts`. Alternatively, paste it directly into the handler options. The
snippets below show the callback form.

## Check the browser origin

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

Include `trustedBrowserRequest` in the module containing your auth callback. Set
`APP_ORIGIN` to your configured app URL, including its local development port.
It must come from your server environment.

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

A shared store keeps limits consistent across server processes. Create an
Upstash Redis database and add its `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` values to your server environment. Install:

**npm**

```bash
npm install @upstash/ratelimit @upstash/redis
```

**pnpm**

```bash
pnpm add @upstash/ratelimit @upstash/redis
```

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
Choose limits that fit your app’s expected usage. If the quota store is
unavailable, reject the request rather than issuing unlimited credentials. This
example propagates the store error so the handler rejects the request.
