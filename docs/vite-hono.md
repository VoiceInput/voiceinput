# Vite + Hono

Serve the React app with Vite and mount the Fetch-standard token handler in a
Hono API. Use Vite's development proxy so the browser keeps a same-origin token
URL.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/openai hono @hono/node-server
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/openai hono @hono/node-server
```

Set `OPENAI_API_KEY` and `APP_ORIGIN=http://localhost:5173` in the API process.
Never expose the provider key through a `VITE_` variable.

## Create the Hono server

```ts title="server.ts"
import { serve } from "@hono/node-server";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { Hono } from "hono";
import { getCurrentUser } from "./auth.ts"; // your existing session check

const appOrigin = new URL(process.env.APP_ORIGIN!).origin;
const issueVoiceToken = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});

const app = new Hono();
app.post("/api/voice-token", (context) => issueVoiceToken(context.req.raw));

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8787 });
```

`context.req.raw` is a web `Request`, and the handler returns a web `Response`.
Connect your session and quota store with the
[authentication recipes](authentication-recipes.md).

## Proxy API requests through Vite

```ts title="vite.config.ts"
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

## Add the React field

```tsx title="src/App.tsx"
import { useState } from "react";
import { openai } from "@voiceinput/openai";
import { getVoiceInputErrorMessage, useVoiceInput } from "@voiceinput/react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function App() {
  const [message, setMessage] = useState("");
  const voice = useVoiceInput({
    provider,
    value: message,
    onValueChange: setMessage,
  });
  const active = voice.status !== "idle" && voice.status !== "error";

  return (
    <>
      <textarea
        aria-label="Message"
        ref={voice.targetRef}
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
      />
      <button {...voice.getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
      {voice.error ? (
        <p role="alert">{getVoiceInputErrorMessage(voice.error)}</p>
      ) : null}
    </>
  );
}
```

## Run

Node.js 22.18+ strips erasable TypeScript syntax, so start the API directly:

```bash
node server.ts
```

Start Vite with your app's normal development command, open its URL, and press
**Speak**. The browser sends `/api/voice-token` through the proxy.

## Production

- Terminate HTTPS in front of both the Vite assets and API.
- Route assets and `/api` through one origin when practical.
- Authenticate every token request and use a shared quota store.
- Keep provider keys in the API environment.
- Import provider `/server` entries only from server code.
- Allow the provider WebSocket in your
  [Content Security Policy](content-security-policy.md).

The [Vite + Hono example](../examples/vite-hono) provides a full-stack setup.
