# Quickstart

Add a voice button to an existing Next.js textarea with OpenAI.

## 1. Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/openai
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/openai
```

## 2. Add server environment variables

Create `.env.local` with your OpenAI key and the exact origin of your app:

```dotenv
OPENAI_API_KEY=your-openai-api-key
APP_ORIGIN=http://localhost:3000
```

Keep `OPENAI_API_KEY` server-only. Never give it a `NEXT_PUBLIC_` prefix.

## 3. Create the token route

```ts title="src/app/api/voice-token/route.ts"
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { getCurrentUser } from "@/lib/auth"; // your existing session check

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

Returning `null` produces a `401` without issuing a credential. Replace
`getCurrentUser` with the session check already used by your app.

## 4. Add the field

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
      {voice.error ? (
        <p role="alert">{getVoiceInputErrorMessage(voice.error)}</p>
      ) : null}
    </div>
  );
}
```

Render `Composer` from a page that your signed-in users can access.

## 5. Run

Start the Next.js development server, open the app, and press **Speak**. Allow
microphone access and dictate into the textarea. Restart the server after
changing `.env.local`.

If the route returns `401`, check the session and `APP_ORIGIN`. For other
failures, use the [troubleshooting guide](troubleshooting.md).

## Next steps

- Use the ready-made [`VoiceTextarea`](../packages/react/README.md#components).
- Add your auth library with the
  [authentication recipes](authentication-recipes.md).
- Protect the route with a
  [durable rate limit](authentication-recipes.md#durable-upstash-quota).
- Run the [full-stack examples](golden-paths.md).
