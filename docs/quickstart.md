# Quickstart

Add a voice button to an existing React textarea. This example uses **Next.js
App Router, OpenAI, and an existing Clerk sign-in setup**. For another stack,
follow [Vite + Hono](vite-hono.md), [Express](express.md), or the
[authentication recipes](authentication-recipes.md).

## Before you start

- A Next.js app using React 18.2+ or React 19 and Node.js 22+.
- Clerk sign-in already configured, including its middleware. Use the
  [Clerk Next.js setup](https://clerk.com/docs/quickstarts/nextjs) if needed.
- An OpenAI API key with access to transcription.

For a complete starter with Clerk and rate limits already wired up, use the
[Next.js example project](golden-paths.md). To explore without credentials, try
the [simulated example](golden-paths.md#simulated-fields).

<span id="1-install"></span>

## 1. Install the packages

**npm**

```bash
npm install @voiceinput/react@next @voiceinput/openai@next
```

**pnpm**

```bash
pnpm add @voiceinput/react@next @voiceinput/openai@next
```

`@next` selects the VoiceInput beta release channel. It is unrelated to Next.js.

## 2. Set your server environment variables

Add these values to `.env.local` in your app. Keep your existing Clerk settings.
Use your app's actual origin, including the development port.

```dotenv title=".env.local"
OPENAI_API_KEY=your-openai-api-key
APP_ORIGIN=http://localhost:3000
```

Keep `OPENAI_API_KEY` server-only. Never give it a `NEXT_PUBLIC_` prefix.

<span id="2-add-an-authenticated-server-route"></span>

## 3. Create the token route

The route checks the signed-in user before issuing a temporary credential. If
your app uses another auth library, replace the `authorize` callback with the
matching [authentication recipe](authentication-recipes.md).

```ts title="src/app/api/voice-token/route.ts"
import { auth } from "@clerk/nextjs/server";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";

export const runtime = "nodejs";

const apiKey = process.env.OPENAI_API_KEY;
const origin = process.env.APP_ORIGIN;
if (!apiKey || !origin) {
  throw new Error("OPENAI_API_KEY and APP_ORIGIN are required.");
}
const appOrigin = new URL(origin).origin;

export const POST = createOpenAITokenHandler({
  apiKey,
  authorize: async (request) => {
    if (
      request.headers.get("origin") !== appOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return null;

    const { isAuthenticated, userId } = await auth();
    return isAuthenticated && userId ? { subject: userId } : null;
  },
});
```

Returning `null` produces a `401` response without issuing a credential. Keep
this route on the same origin as the React app so its session cookies are sent
automatically. Before production, add a
[shared rate limit](authentication-recipes.md#durable-upstash-quota).

<span id="3-enhance-a-field"></span>

## 4. Add the React field

Keep a native textarea's ordinary `onChange` handler for typing. The hook's
`onValueChange` callback updates the same state when dictation changes the text.

```tsx title="src/app/composer.tsx"
"use client";

import { useState } from "react";
import { openai } from "@voiceinput/openai";
import { useVoiceInput } from "@voiceinput/react";

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
    <div>
      <label htmlFor="message">Message</label>
      <textarea
        id="message"
        ref={voice.targetRef}
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
      />
      <button {...voice.getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
      <output aria-live="polite">{voice.status}</output>
      {voice.error ? <p role="alert">{voice.error.message}</p> : null}
    </div>
  );
}
```

Render it in a page your signed-in users can access:

```tsx title="src/app/page.tsx"
import { Composer } from "./composer";

export default function Page() {
  return <Composer />;
}
```

## 5. Run and try it

**npm**

```bash
npm run dev
```

**pnpm**

```bash
pnpm run dev
```

Open your app, sign in, click in the textarea, and press **Speak**. Allow
microphone access and say a short sentence. Text should appear at the cursor.
Press **Stop**, then try typing and undoing an edit.

If it does not work, check the [troubleshooting guide](troubleshooting.md). A
`401` usually means the session or configured origin did not match. Restart the
development server after changing environment variables.

## Optional: use a ready-made field

Replace the native field and button with `VoiceTextarea` if you want a control
that already includes the voice button. Its `onValueChange` handles both typing
and dictation, so a second state setter in `onChange` is unnecessary.

```tsx
import { VoiceTextarea } from "@voiceinput/react";

<VoiceTextarea
  aria-label="Message"
  value={message}
  onValueChange={setMessage}
  voice={{ provider }}
/>;
```

Import the optional theme once in your root layout:

```ts
import "@voiceinput/react/styles.css";
```

For multiple fields, `VoiceInputProvider` can share configuration and coordinate
which field uses the microphone. A standalone field does not need it. Continue
with the [React API](../packages/react/README.md) or the
[deployment checklist](nextjs.md#deployment-checklist).
