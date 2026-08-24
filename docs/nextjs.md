# Next.js App Router integration

This guide keeps the long-lived provider key in a server-only App Router route
and streams microphone audio directly from the browser to the provider.

The examples use OpenAI. For ElevenLabs or Deepgram, substitute the adapter and
token handler; the React field code stays the same.

## Install

```bash
npm install @voiceinput/react @voiceinput/openai
```

Set the key only in the server environment:

```dotenv
OPENAI_API_KEY=...
```

Do not use a `NEXT_PUBLIC_` name.

## Create the token route

```ts
// src/app/api/voice-token/route.ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { consumeVoiceQuota } from "@/lib/voice-quota";

export const runtime = "nodejs";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");

export const POST = createOpenAITokenHandler({
  apiKey,
  authorize: async (request) => {
    const user = await getAuthenticatedUser(request);
    return user ? { subject: user.id } : null;
  },
  rateLimit: async ({ subject }) => {
    const result = await consumeVoiceQuota(subject);
    return result.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
  },
  onTokenIssued: ({ subject, model, expiresAt }) => {
    // Audit metadata only. Do not log request bodies, credentials, or audio.
    console.info("voice-token-issued", { subject, model, expiresAt });
  },
});
```

`authorize` is mandatory and runs before minting. Returning `null` produces a
`401`. `rateLimit` is optional, but production deployments should back it with
durable shared storage rather than a process-local map.

The handler accepts the standard web `Request` and returns a standard
`Response`, so no Next.js-specific adapter is needed.

## Add the provider context

```tsx
// src/app/providers.tsx
"use client";

import { openai } from "@voiceinput/openai";
import { VoiceInputProvider } from "@voiceinput/react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <VoiceInputProvider provider={provider}>{children}</VoiceInputProvider>
  );
}
```

Mount it from the root layout:

```tsx
// src/app/layout.tsx
import { Providers } from "./providers";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

## Enhance a controlled field

```tsx
"use client";

import { useVoiceInput } from "@voiceinput/react";
import { useState } from "react";

export function Composer() {
  const [message, setMessage] = useState("");
  const voice = useVoiceInput({
    value: message,
    onValueChange: setMessage,
    language: "en-US",
    vocabulary: ["VoiceInput"],
  });

  return (
    <form>
      <textarea
        ref={voice.targetRef}
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
      />
      <button {...voice.triggerProps}>
        {voice.status === "listening" ? "Stop" : "Speak"}
      </button>
      <output aria-live="polite">{voice.status}</output>
      {voice.error ? <p role="alert">{voice.error.message}</p> : null}
    </form>
  );
}
```

For the optional component and theme:

```tsx
// src/app/layout.tsx
import "@voiceinput/react/styles.css";

// In a client component:
<VoiceTextarea
  value={message}
  onValueChange={setMessage}
  onChange={(event) => setMessage(event.currentTarget.value)}
/>;
```

The stylesheet import is optional and never occurs automatically. The native
`onChange` still owns keyboard edits; `onValueChange` receives voice-engine
writes.

## Switch providers

| Provider   | Browser factory                            | Server handler                                                      | Server key           |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------- | -------------------- |
| OpenAI     | `openai` from `@voiceinput/openai`         | `createOpenAITokenHandler` from `@voiceinput/openai/server`         | `OPENAI_API_KEY`     |
| ElevenLabs | `elevenlabs` from `@voiceinput/elevenlabs` | `createElevenLabsTokenHandler` from `@voiceinput/elevenlabs/server` | `ELEVENLABS_API_KEY` |
| Deepgram   | `deepgram` from `@voiceinput/deepgram`     | `createDeepgramTokenHandler` from `@voiceinput/deepgram/server`     | `DEEPGRAM_API_KEY`   |

Pin the same model in the browser factory and token handler when overriding a
default. If clients may request more than one model, set an explicit
`allowedModels` list on the handler.

## Deployment checklist

- Serve the application over HTTPS.
- Keep the token endpoint same-origin when practical; the adapters send cookies
  with `credentials: "same-origin"`.
- Protect the endpoint with your real session/authentication system.
- Use a shared quota store for multi-instance or serverless deployments.
- Add the selected provider's WebSocket origin to `connect-src` if you use CSP.
- Never import a provider `/server` entry from a client component.
- Do not log API keys, issued credentials, request bodies, audio, or transcript
  content unless your own privacy policy explicitly requires it.

## About the repository playground

`apps/playground-next` uses a signed cookie and loopback checks only to exercise
authorized, unauthorized, and expired-session paths locally. It disables that
fixture in production. It is **not production authentication or rate limiting**;
do not copy it into an application.

See [troubleshooting](troubleshooting.md) for microphone and browser issues.
