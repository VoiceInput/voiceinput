![VoiceInput](.github/assets/readme-banner.png)

# VoiceInput

Add dictation to React inputs and textareas without replacing your field.

## Why VoiceInput

- Preserve selections, caret movement, manual edits, and controlled React state.
- Switch between OpenAI, ElevenLabs, and Deepgram without changing field code.
- Use toggle or hold-to-talk activation with keyboard and pointer support.
- Keep long-lived provider keys on your server.
- Start with the headless hook or accessible ready-made controls.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/openai
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/openai
```

```tsx
"use client";

import { getVoiceInputErrorMessage, useVoiceInput } from "@voiceinput/react";
import { openai } from "@voiceinput/openai";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Composer() {
  const { targetRef, getTriggerProps, status, error } = useVoiceInput({
    provider,
  });
  const active = status !== "idle" && status !== "error";

  return (
    <>
      <textarea aria-label="Message" name="message" ref={targetRef} />
      <button {...getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
      {error && <p role="alert">{getVoiceInputErrorMessage(error)}</p>}
    </>
  );
}
```

Create a server route that authorizes the current user before issuing a
temporary provider credential:

```ts
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

## How it works

1. The user starts dictation and grants microphone access.
2. Your authenticated route issues a temporary provider credential.
3. The browser streams audio directly to the transcription provider.
4. VoiceInput inserts returned text at the user's current selection.

## Packages

| Package                                                   | Purpose                                             |
| --------------------------------------------------------- | --------------------------------------------------- |
| [`@voiceinput/react`](packages/react/README.md)           | Headless hook, context, and optional controls       |
| [`@voiceinput/openai`](packages/openai/README.md)         | OpenAI Realtime transcription                       |
| [`@voiceinput/elevenlabs`](packages/elevenlabs/README.md) | ElevenLabs Realtime Scribe                          |
| [`@voiceinput/deepgram`](packages/deepgram/README.md)     | Deepgram live transcription                         |
| [`@voiceinput/core`](packages/core/README.md)             | Framework-neutral sessions, audio, and text editing |
| [`@voiceinput/provider`](packages/provider/README.md)     | Provider contracts and conformance tools            |

## Documentation

[Quickstart](docs/quickstart.md) · [Overview](docs/overview.md) ·
[Providers](docs/providers.md) · [Examples](docs/golden-paths.md) ·
[React API](packages/react/README.md) ·
[Browser support](docs/support-policy.md) ·
[Troubleshooting](docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
