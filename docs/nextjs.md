# Next.js App Router integration

Add dictation to a Next.js App Router app. Your server issues temporary
credentials, and the browser streams audio directly to the provider.

For a first integration, follow the [quickstart](quickstart.md). This guide adds
shared configuration and deployment settings to an existing app.

The examples use OpenAI. For ElevenLabs or Deepgram, substitute the adapter and
token handler; the React field code stays the same.

## Install

**npm**

```bash
npm install @voiceinput/react@next @voiceinput/openai@next
```

**pnpm**

```bash
pnpm add @voiceinput/react@next @voiceinput/openai@next
```

Add these values to your app’s `.env.local`. During development, set
`APP_ORIGIN` to your local URL, including the port:

```dotenv
OPENAI_API_KEY=...
APP_ORIGIN=https://app.example.com
```

Do not use a `NEXT_PUBLIC_` name.

## Create the token route

`getAuthenticatedUser` and `consumeVoiceQuota` below are **your application
helpers**, not VoiceInput exports. The first validates the request using your
existing sign-in system and returns a user or `null`. The second checks a shared
quota store and returns an allowed/denied result. Implement them using the
[authentication and rate-limit recipes](authentication-recipes.md), or start
from the
[complete Next.js example](golden-paths.md#nextjs-with-clerk-and-upstash).

```ts
// src/app/api/voice-token/route.ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { consumeVoiceQuota } from "@/lib/voice-quota";

export const runtime = "nodejs";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

export const POST = createOpenAITokenHandler({
  apiKey,
  authorize: async (request) => {
    if (
      request.headers.get("origin") !== appOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return null;
    }
    const user = await getAuthenticatedUser(request);
    return user ? { subject: user.id } : null;
  },
  rateLimit: async ({ subject }) => {
    const result = await consumeVoiceQuota({
      key: `voice-token:${subject}`,
      limit: 10,
      windowSeconds: 60,
    });
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

`authorize` is mandatory and runs before a credential is issued. Returning
`null` produces a `401`. `rateLimit` is optional, but production deployments
should back it with durable shared storage rather than a process-local map.

The handler accepts the standard web `Request` and returns a standard
`Response`, so no Next.js-specific adapter is needed.

## Add the provider context

This step is optional. Use context when several fields share a provider and
should coordinate microphone access. For one field, pass `provider` directly to
`useVoiceInput`, as shown in the [quickstart](quickstart.md).

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
  const active = voice.status !== "idle" && voice.status !== "error";

  return (
    <form>
      <textarea
        aria-label="Message"
        ref={voice.targetRef}
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
      />
      <button {...voice.getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
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
import { VoiceTextarea } from "@voiceinput/react";

<VoiceTextarea value={message} onValueChange={setMessage} />;
```

The stylesheet is optional. A controlled `VoiceTextarea` needs `value` and
`onValueChange`; that callback handles typing, dictation, undo, and redo. Do not
attach a second state setter to `onChange`. When using the hook with your own
native field, keep that field’s ordinary `onChange` for typing.

## Run the app

**npm**

```bash
npm run dev
```

**pnpm**

```bash
pnpm run dev
```

Sign in, open the page containing `Composer`, and press **Speak**. Allow the
microphone and dictate a sentence. If the field remains empty, check the
[token endpoint and microphone troubleshooting](troubleshooting.md).

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
- For cookie authentication, require the exact configured `Origin` and reject
  `Sec-Fetch-Site: cross-site`; do not derive the trusted origin from `Host` or
  forwarded headers supplied by the request.
- Use a shared quota store for multi-instance or serverless deployments.
- Rate-limit before issuing credentials with a durable key such as
  `voice-token:<authenticated-subject>`; the example permits 10 attempts per 60
  seconds. Add a separately trusted client-IP dimension when your proxy setup
  can supply one safely.
- Under CSP, allow the selected provider's exact WebSocket origin in
  `connect-src`. Self-host the AudioWorklet when `blob:` scripts are disallowed;
  see the [Content Security Policy guide](content-security-policy.md).
- Never import a provider `/server` entry from a client component.
- Do not log API keys, issued credentials, request bodies, audio, or transcript
  content unless your own privacy policy explicitly requires it.

Official handlers require `application/json` and cap the body at 16 KiB before
parsing. `authorize` and `rateLimit` each receive an independent request copy,
so either callback may inspect the body without consuming the helper's copy.
`onTokenIssued` runs before the credential response; if audit persistence
throws, credential delivery fails closed with a generic `500` response.

## About the repository playground

`apps/playground-next` uses a signed cookie and loopback checks only to exercise
authorized, unauthorized, and expired-session paths locally. It disables that
fixture in production. It is **not production authentication or rate limiting**;
do not copy it into an application.

See [troubleshooting](troubleshooting.md) for microphone and browser issues.
