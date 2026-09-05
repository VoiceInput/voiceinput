# Vite + Hono

Vite serves the browser application. Hono mounts the provider's Fetch-standard
token handler on Node. In production, route both through one origin; in local
development, use Vite's proxy so cookies and relative token URLs stay
same-origin.

This example uses OpenAI, matching the
[runnable Vite project](golden-paths.md#vite--hono-with-clerk-and-upstash).
Start with an existing Vite React app and a Node.js 22+ API process. You also
need application authentication and an OpenAI API key.

## Install

Browser application:

**npm**

```bash
npm install @voiceinput/react@next @voiceinput/openai@next
```

**pnpm**

```bash
pnpm add @voiceinput/react@next @voiceinput/openai@next
```

API application:

**npm**

```bash
npm install @voiceinput/openai@next hono @hono/node-server
```

**pnpm**

```bash
pnpm add @voiceinput/openai@next hono @hono/node-server
```

Set `OPENAI_API_KEY` and `APP_ORIGIN` in the API process environment. For the
default Vite development URL, use `APP_ORIGIN=http://localhost:5173`. Never
prefix the provider key with `VITE_`.

## Hono API

The `authenticateRequest` and `consumeVoiceQuota` imports below are your
application’s helpers. Connect your sign-in system and shared quota store using
the [authentication recipes](authentication-recipes.md). The
[complete Vite example](../examples/vite-hono) includes Clerk and Upstash.

```ts
// server.ts
import { serve } from "@hono/node-server";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { Hono } from "hono";

import { authenticateRequest } from "./auth.js";
import { consumeVoiceQuota } from "./quota.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");

const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

const issueVoiceToken = createOpenAITokenHandler({
  apiKey,
  authorize: async (request) => {
    if (
      request.headers.get("origin") !== appOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return null;
    const user = await authenticateRequest(request);
    return user ? { subject: user.id } : null;
  },
  rateLimit: async ({ subject }) => consumeVoiceQuota(subject),
});

const app = new Hono();
app.post("/api/voice-token", (context) => issueVoiceToken(context.req.raw));

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8787 });
```

Hono's `context.req.raw` is already a web `Request`, and the returned web
`Response` can be returned directly.

## Vite development proxy

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
```

This keeps `tokenEndpoint: "/api/voice-token"` same-origin in the browser.
Official adapters intentionally use `credentials: "same-origin"`. A
cookie-authenticated token endpoint must therefore stay same-origin unless you
supply the provider factory with a custom `fetch` wrapper that uses
`credentials: "include"`; that cross-origin server must also configure
credentialed CORS for the exact browser origin.

## React application

```tsx
// src/main.tsx
import { openai } from "@voiceinput/openai";
import { VoiceInputProvider, VoiceTextarea } from "@voiceinput/react";
import "@voiceinput/react/styles.css"; // optional
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceInputProvider provider={provider}>
      <VoiceTextarea aria-label="Message" name="message" defaultValue="" />
    </VoiceInputProvider>
  </StrictMode>,
);
```

For a controlled `VoiceTextarea`, supply `value` and `onValueChange`. This
callback handles both typing and dictation; a second typing handler is
unnecessary. A native field used with `useVoiceInput` still needs its ordinary
`onChange` handler. Context is optional for a standalone field: pass
`voice={{ provider }}` directly to the wrapper instead.

## Run both processes

Export your server environment variables, then run the API from its directory:

```bash
node --experimental-strip-types server.ts
```

This command assumes your `auth.js` and `quota.js` application helpers are
available beside `server.ts`. If your API uses a build step, use its existing
start command instead. In the Vite application directory, run:

**npm**

```bash
npm run dev
```

**pnpm**

```bash
pnpm run dev
```

Open the Vite URL, sign in, and press **Speak**. The browser sends token
requests through the development proxy. Check for a `401` if the session or
`APP_ORIGIN` is incorrect. See [troubleshooting](troubleshooting.md).

## Production checklist

- Terminate HTTPS in front of both browser and API traffic.
- Authenticate every token request; returning `null` from `authorize` prevents
  credentials from being issued.
- Use durable shared quota state rather than a process-local counter.
- Proxy `/api` and the Vite assets through one origin when practical.
- Never use a `VITE_` variable for a long-lived provider API key.
- Import `/server` only in the Node API.

## About the repository playground

`apps/playground-api` and `apps/playground-vite` contain a loopback-only signed
cookie fixture for deterministic local testing. It is disabled in production and
is **not an authentication or rate-limit design for applications**.

For an existing Express API, use the [thin bridge](express.md).
