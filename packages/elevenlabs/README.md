# `@voiceinput/elevenlabs`

Use ElevenLabs Realtime Scribe with VoiceInput. Keep the long-lived provider key
on the server and give the browser a temporary credential through an
authenticated route. Follow the [quickstart](../../docs/quickstart.md) for a
complete application.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/elevenlabs
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/elevenlabs
```

## Browser adapter

```ts
import { elevenlabs } from "@voiceinput/elevenlabs";

const provider = elevenlabs({
  tokenEndpoint: "/api/voice-token",
});
```

Pass `provider` to `VoiceInputProvider` or directly to `useVoiceInput`.

## Server token handler

Keep this code in a server route. Add your session and origin checks in
`authorize`; see the
[authentication recipes](../../docs/authentication-recipes.md) for complete
examples.

```ts
import { createElevenLabsTokenHandler } from "@voiceinput/elevenlabs/server";
import { getCurrentUser } from "@/lib/auth"; // your existing session check

const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

export const POST = createElevenLabsTokenHandler({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});
```

The handler accepts only `POST`, requires authorization, sets
`Cache-Control: no-store`, and returns a single-use token rather than the
long-lived API key. Requests must be JSON and are limited to 16 KiB.
Authorization and rate-limit callbacks receive independent request bodies. If
`onTokenIssued` throws, token delivery fails closed.

### `CreateElevenLabsTokenHandlerOptions`

| Option                      | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `apiKey`                    | Required server-only ElevenLabs key                      |
| `authorize(request)`        | Required application authorization                       |
| `model`                     | Default model; default `scribe_v2_realtime`              |
| `allowedModels`             | Browser-selectable models; defaults to only `model`      |
| `rateLimit(context)`        | Optional application quota check                         |
| `onTokenIssued(metadata)`   | Metadata-only callback with provider, subject, and model |
| `fetch`, `providerTokenUrl` | Transport/endpoint overrides                             |

Callback context uses `VoiceTokenHandlerContext` from `@voiceinput/provider`.
`ElevenLabsTokenIssuedMetadata` contains `provider: "elevenlabs"`, `subject`,
and `model`. The handler omits the optional `expiresAt` field because the token
is single use.

## Transcription options

Start with the defaults. `language` hints at the spoken language, `vocabulary`
helps recognize specific terms, and `endpointing` controls when a pause ends a
phrase. Set these shared options on the React hook or under a control’s `voice`
prop. Provider-only options belong in the browser factory.

### Defaults and shared-option mapping

- Model: `scribe_v2_realtime` (`ELEVENLABS_DEFAULT_MODEL`)
- Audio: mono PCM16 at 16 kHz
- Omitted language: provider automatic detection
- `language`: normalized to an ISO 639-1 or ISO 639-3 primary code
- `vocabulary`: ElevenLabs key terms
- `endpointing`: VAD with a 650 ms silence threshold when omitted, manual commit
  when `false`, or VAD with a supplied 300–3000 ms silence threshold

Vocabulary accepts at most 50 trimmed terms, each at most 20 characters and
without line breaks.

### `ElevenLabsVoiceInputProviderOptions`

| Option                              | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `tokenEndpoint`                     | Required same-origin endpoint that returns a single-use token |
| `model`                             | Model ID; default `scribe_v2_realtime`                        |
| `finishTimeoutMs`                   | Standalone final-commit deadline; default 20 seconds          |
| `vadThreshold`                      | VAD threshold from 0.1 to 0.9                                 |
| `minSpeechDurationMs`               | Integer from 50 to 2000                                       |
| `minSilenceDurationMs`              | Integer from 50 to 2000                                       |
| `noVerbatim`                        | Provider no-verbatim behavior                                 |
| `filterBackgroundAudio`             | Provider background-audio filtering                           |
| `fetch`, `webSocket`, `realtimeUrl` | Transport/endpoint overrides                                  |

Provider-only VAD settings customize the VAD behavior used by the portable 650
ms default. When used through `@voiceinput/core` or `@voiceinput/react`, the
session's `finalizationTimeoutMs` (15 seconds by default) governs graceful
fallback first. `finishTimeoutMs` is the adapter's standalone safety limit.

## Public API

Browser root:

- `elevenlabs(options)`
- `ELEVENLABS_DEFAULT_MODEL`
- `ElevenLabsVoiceInputProviderOptions`

Server-only entry point:

- `createElevenLabsTokenHandler(options)`
- `CreateElevenLabsTokenHandlerOptions`
- `ElevenLabsTokenIssuedMetadata`

Shared authorization, rate-limit, handler-context, and issued-metadata types
come from `@voiceinput/provider`.

## Security

Import `/server` only from server code; the export is disabled under the browser
condition. Never expose `ELEVENLABS_API_KEY` to the client. The browser uses the
single-use token to stream audio directly to ElevenLabs.

See [how VoiceInput works](../../docs/overview.md#how-it-works) for the complete
credential and audio security boundary.
