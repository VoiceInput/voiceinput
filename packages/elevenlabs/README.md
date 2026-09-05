# `@voiceinput/elevenlabs`

Use ElevenLabs Realtime Scribe to transcribe audio from your React fields. You
need a provider API key and an authenticated server route. The browser uses
temporary credentials; your long-lived key stays on the server.

For a full application example, follow the
[quickstart](../../docs/quickstart.md) or an
[integration guide](../../docs/overview.md#choose-an-integration).

## Install

**npm**

```bash
npm install @voiceinput/react@next @voiceinput/elevenlabs@next
```

**pnpm**

```bash
pnpm add @voiceinput/react@next @voiceinput/elevenlabs@next
```

## Browser adapter

```ts
import { elevenlabs } from "@voiceinput/elevenlabs";

const provider = elevenlabs({
  tokenEndpoint: "/api/voice-token",
});
```

## Server token handler

Keep this code in a server route. `authenticate(request)` below represents your
existing authentication function, not a VoiceInput export. It must validate the
request and return a user or `null`. For cookie sessions, also validate the
configured origin. Copy the complete route from the
[quickstart](../../docs/quickstart.md#3-create-the-token-route) or use an
[authentication recipe](../../docs/authentication-recipes.md).

```ts
import { createElevenLabsTokenHandler } from "@voiceinput/elevenlabs/server";

export const POST = createElevenLabsTokenHandler({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  authorize: async (request) => {
    const user = await authenticate(request);
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

| Option                    | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `apiKey`                  | Required server-only ElevenLabs key                      |
| `authorize(request)`      | Required application authorization                       |
| `model`                   | Default model; default `scribe_v2_realtime`              |
| `allowedModels`           | Browser-selectable models; defaults to only `model`      |
| `rateLimit(context)`      | Optional application quota check                         |
| `onTokenIssued(metadata)` | Metadata-only callback with provider, subject, and model |
| `fetch`, `tokenUrl`       | Transport/endpoint overrides                             |

`ElevenLabsTokenHandlerContext` contains `request`, `subject`, and `model`.

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
without line breaks. Invalid or unsupported settings fail before microphone
permission with distinct error codes.

### `ElevenLabsVoiceInputProviderOptions`

| Option                              | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `tokenEndpoint`                     | Required same-origin endpoint that returns a single-use token |
| `model`                             | Model ID; default `scribe_v2_realtime`                        |
| `finishTimeoutMs`                   | Graceful final-commit deadline; default 4 seconds             |
| `vadThreshold`                      | VAD threshold from 0.1 to 0.9                                 |
| `minSpeechDurationMs`               | Integer from 50 to 2000                                       |
| `minSilenceDurationMs`              | Integer from 50 to 2000                                       |
| `noVerbatim`                        | Provider no-verbatim behavior                                 |
| `filterBackgroundAudio`             | Provider background-audio filtering                           |
| `fetch`, `webSocket`, `realtimeUrl` | Transport/endpoint overrides                                  |

Provider-only VAD settings customize the VAD behavior used by the portable 650
ms default.

## Public API

Browser root:

- `elevenlabs(options)`
- `ELEVENLABS_DEFAULT_MODEL`
- `ElevenLabsVoiceInputProviderOptions`

Server-only entry point:

- `createElevenLabsTokenHandler(options)`
- `CreateElevenLabsTokenHandlerOptions`
- `ElevenLabsAuthorization`
- `ElevenLabsRateLimitResult`
- `ElevenLabsTokenHandlerContext`
- `ElevenLabsTokenIssuedMetadata`

## Security

Import `/server` only from server code; the export is disabled under the browser
condition. Never expose `ELEVENLABS_API_KEY` to the client. The browser uses the
single-use token to stream audio directly to ElevenLabs.

See the
[secure integration guides](https://github.com/VoiceInput/voiceinput/blob/main/docs/nextjs.md).
