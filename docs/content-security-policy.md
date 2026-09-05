# Content Security Policy

Use this guide if your app blocks the default audio processor with a strict
Content Security Policy (CSP). VoiceInput normally loads this small browser
audio processor, called an AudioWorklet, from a temporary Blob URL without extra
asset setup. Applications that do not allow `blob:` scripts can self-host the
same processor and pass its URL to the browser audio source.

## Self-host the worklet

Install `@voiceinput/core` directly in the application, using the same release
as your React package:

**npm**

```bash
npm install @voiceinput/core@next
```

**pnpm**

```bash
pnpm add @voiceinput/core@next
```

Create a build script that writes the matching audio processor to your public
assets directory:

```js
// scripts/write-voiceinput-worklet.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { VOICE_INPUT_AUDIO_WORKLET_SOURCE } from "@voiceinput/core";

await mkdir("public", { recursive: true });
await writeFile(
  "public/voiceinput-worklet.js",
  VOICE_INPUT_AUDIO_WORKLET_SOURCE,
);
```

Run the script before the application build:

```bash
node scripts/write-voiceinput-worklet.mjs
```

Add this command to your existing build pipeline and run it again whenever
VoiceInput is upgraded. Next.js and Vite both serve files from `public/` at the
origin root. Configure one stable audio source and pass it to the React
provider:

```tsx
"use client";

import { createBrowserAudioSource } from "@voiceinput/core";
import {
  VoiceInputProvider,
  type VoiceInputProviderV1,
} from "@voiceinput/react";
import type { ReactNode } from "react";

const audioSource = createBrowserAudioSource({
  workletModuleUrl: "/voiceinput-worklet.js",
});

export function AppVoiceProvider({
  provider,
  children,
}: {
  provider: VoiceInputProviderV1;
  children: ReactNode;
}) {
  return (
    <VoiceInputProvider provider={provider} audioSource={audioSource}>
      {children}
    </VoiceInputProvider>
  );
}
```

Regenerate the file whenever `@voiceinput/core` changes. Set a normal JavaScript
content type such as `text/javascript; charset=utf-8`, keep the asset
same-origin when possible, and do not attach secrets or user data to its URL.

## Directives

The current CSP specification classifies the AudioWorklet fetch destination as
`audioworklet` and maps it to `script-src-elem`, which falls back to
`script-src` and then `default-src`. A conservative same-origin policy therefore
allows the worklet in both script directives:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  script-src-elem 'self';
  connect-src 'self' wss://api.openai.com;
  object-src 'none';
  base-uri 'self'
```

Merge those sources into the application's existing policy; framework nonces,
hashes, styles, images, and other resources remain application-specific. The
same-origin worklet path does not require `blob:` or a `worker-src` exception.
The default Blob path instead requires `blob:` in the effective directive:
`script-src-elem` when it is present, otherwise its `script-src` fallback.

`connect-src 'self'` covers a same-origin token endpoint. Add exactly the
selected provider's realtime origin:

| Provider   | `connect-src` source      |
| ---------- | ------------------------- |
| OpenAI     | `wss://api.openai.com`    |
| ElevenLabs | `wss://api.elevenlabs.io` |
| Deepgram   | `wss://api.deepgram.com`  |

If the token endpoint is cross-origin, add its HTTPS origin separately. Avoid
wildcard provider domains.

References:
[CSP request destinations and fallback rules](https://www.w3.org/TR/CSP/#effective-directive-for-a-request),
[Web Audio AudioWorklet loading](https://www.w3.org/TR/webaudio-1.0/#AudioWorklet-section).
