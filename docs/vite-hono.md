# Vite with a Hono-on-Node token API

Vite serves the browser application. Hono mounts the provider's Fetch-standard
token handler on Node. In production, route both through one origin; in local
development, use Vite's proxy so cookies and relative token URLs stay
same-origin.

The example uses Deepgram.

## Install

Browser application:

```bash
npm install @voiceinput/react @voiceinput/deepgram
```

API application:

```bash
npm install @voiceinput/deepgram hono @hono/node-server
```

Keep `DEEPGRAM_API_KEY` only in the API process environment.

## Hono API

```ts
// server.ts
import { serve } from "@hono/node-server";
import { createDeepgramTokenHandler } from "@voiceinput/deepgram/server";
import { Hono } from "hono";

import { authenticateRequest } from "./auth.js";
import { consumeVoiceQuota } from "./quota.js";

const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) throw new Error("DEEPGRAM_API_KEY is required.");

const issueVoiceToken = createDeepgramTokenHandler({
  apiKey,
  ttlSeconds: 30,
  authorize: async (request) => {
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
import { deepgram } from "@voiceinput/deepgram";
import { VoiceInputProvider, VoiceTextarea } from "@voiceinput/react";
import "@voiceinput/react/styles.css"; // optional
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const provider = deepgram({ tokenEndpoint: "/api/voice-token" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceInputProvider provider={provider}>
      <VoiceTextarea name="message" defaultValue="" />
    </VoiceInputProvider>
  </StrictMode>,
);
```

For controlled application state, provide both `value` and `onValueChange`, and
continue to use the native `onChange` handler for keyboard edits.

## Production checklist

- Terminate HTTPS in front of both browser and API traffic.
- Authenticate every token request; returning `null` from `authorize` prevents
  minting.
- Use durable shared quota state rather than a process-local counter.
- Proxy `/api` and the Vite assets through one origin when practical.
- Never use a `VITE_` variable for a long-lived provider API key.
- Import `/server` only in the Node API.

## About the repository playground

`apps/playground-api` and `apps/playground-vite` contain a loopback-only signed
cookie fixture for deterministic local testing. It is disabled in production and
is **not an authentication or rate-limit design for applications**.

For an existing Express API, use the [thin bridge](express.md).
