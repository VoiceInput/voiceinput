# Next.js App Router

Add VoiceInput to an existing Next.js App Router application. The server issues
temporary credentials, and the browser streams audio directly to the provider.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/openai
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/openai
```

Add the provider key and exact application origin to `.env.local`:

```dotenv
OPENAI_API_KEY=your-openai-api-key
APP_ORIGIN=http://localhost:3000
```

## Create the token route

```ts title="src/app/api/voice-token/route.ts"
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getCurrentUser } from "@/lib/auth"; // your existing session check

export const runtime = "nodejs";
const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

export const POST = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});
```

Returning `null` produces a `401`. Use the
[authentication and rate-limit recipes](authentication-recipes.md) to connect
your session library, reject cross-site requests, and add a shared quota.

## Add a field

Pass the provider directly for a self-contained field:

```tsx title="src/app/composer.tsx"
"use client";

import { useState } from "react";
import { openai } from "@voiceinput/openai";
import { getVoiceInputErrorMessage, useVoiceInput } from "@voiceinput/react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Composer() {
  const [message, setMessage] = useState("");
  const voice = useVoiceInput({
    provider,
    value: message,
    onValueChange: setMessage,
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
      {voice.error ? (
        <p role="alert">{getVoiceInputErrorMessage(voice.error)}</p>
      ) : null}
    </form>
  );
}
```

Start the development server, visit the page, and press **Speak**. Check the
[troubleshooting guide](troubleshooting.md) if the field stays empty.

## Share configuration across fields

Context is optional. Use it when several fields share a provider and need to
coordinate microphone ownership:

```tsx title="src/app/providers.tsx"
"use client";

import { openai } from "@voiceinput/openai";
import { VoiceInputProvider } from "@voiceinput/react";
import type { ReactNode } from "react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Providers({ children }: { children: ReactNode }) {
  return (
    <VoiceInputProvider provider={provider}>{children}</VoiceInputProvider>
  );
}
```

Mount `Providers` from the root layout. Descendant hooks can then omit their
`provider` option. See the [React API](../packages/react/README.md) for
ready-made fields and shared recording options.

## Deployment checklist

- Serve the application over HTTPS and keep the token endpoint same-origin.
- Protect the route with your application session and an exact origin check.
- Store quota state in shared durable storage for multi-instance deployments.
- Keep provider keys server-only and import `/server` entries only on the
  server.
- Allow the provider WebSocket origin in CSP `connect-src`; see the
  [CSP guide](content-security-policy.md).
- Avoid logging credentials, audio, transcripts, or token request bodies.

To switch transcription services, choose another adapter in the
[provider guide](providers.md); the field code stays the same.
