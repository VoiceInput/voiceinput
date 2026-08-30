# `@voiceinput/deepgram`

Deepgram live transcription adapter for VoiceInput. The browser-safe root opens
the realtime stream; `@voiceinput/deepgram/server` exchanges a long-lived API
key for a temporary JWT.

## Install

```bash
npm install @voiceinput/react @voiceinput/deepgram
```

## Browser adapter

```ts
import { deepgram } from "@voiceinput/deepgram";

const provider = deepgram({
  tokenEndpoint: "/api/voice-token",
  smartFormat: true,
  punctuate: true,
});
```

### Defaults and shared-option mapping

- Model: `nova-3` (`DEEPGRAM_DEFAULT_MODEL`)
- Audio: mono linear PCM16 at 16 kHz
- Omitted language: `multi` for `nova-2`, `nova-2-general`, `nova-3`, and
  `nova-3-general`; other models require an explicit BCP 47 language
- General Nova-2 and Nova-3 preserve supported regional English tags and
  normalize unsupported tags such as `en-CA` to `en`; specialized models keep
  their regional language tags exact
- `vocabulary`: Deepgram key terms, supported only by Nova-3 model IDs
- `endpointing`: provider default when omitted, disabled when `false`, or the
  supplied positive integer silence threshold
- `smartFormat` and `punctuate`: both default to `true`

Invalid or unsupported settings fail before microphone permission.

### `DeepgramVoiceInputProviderOptions`

| Option                              | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `tokenEndpoint`                     | Required same-origin endpoint that returns a temporary JWT |
| `model`                             | Model ID; default `nova-3`                                 |
| `smartFormat`                       | Deepgram smart formatting; default `true`                  |
| `punctuate`                         | Punctuation; default `true`                                |
| `profanityFilter`                   | Provider profanity filter                                  |
| `numerals`                          | Provider numeral conversion                                |
| `fetch`, `webSocket`, `realtimeUrl` | Transport/endpoint overrides                               |

## Server token handler

```ts
import { createDeepgramTokenHandler } from "@voiceinput/deepgram/server";

export const POST = createDeepgramTokenHandler({
  apiKey: process.env.DEEPGRAM_API_KEY!,
  ttlSeconds: 30,
  authorize: async (request) => {
    const user = await authenticate(request);
    return user ? { subject: user.id } : null;
  },
});
```

The handler accepts only `POST`, requires authorization, sets
`Cache-Control: no-store`, and returns a temporary token rather than the API
key. `ttlSeconds`, when supplied, must be an integer from 1 to 3600.

### `CreateDeepgramTokenHandlerOptions`

| Option                    | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `apiKey`                  | Required server-only Deepgram key                               |
| `authorize(request)`      | Required application authorization                              |
| `model`                   | Default model; default `nova-3`                                 |
| `allowedModels`           | Browser-selectable models; defaults to only `model`             |
| `ttlSeconds`              | Requested temporary-token lifetime, 1–3600 seconds              |
| `rateLimit(context)`      | Optional application quota check                                |
| `onTokenIssued(metadata)` | Metadata-only callback with subject, model, and expiry duration |
| `fetch`, `grantUrl`       | Transport/endpoint overrides                                    |

`DeepgramTokenHandlerContext` contains `request`, `subject`, and `model`.
`DeepgramTokenIssuedMetadata` also contains `expiresIn`.

## Public API

Browser root:

- `deepgram(options)`
- `DEEPGRAM_DEFAULT_MODEL`
- `DeepgramVoiceInputProviderOptions`

Server-only entry point:

- `createDeepgramTokenHandler(options)`
- `CreateDeepgramTokenHandlerOptions`
- `DeepgramAuthorization`
- `DeepgramRateLimitResult`
- `DeepgramTokenHandlerContext`
- `DeepgramTokenIssuedMetadata`

## Security

Import `/server` only from server code; the export is disabled under the browser
condition. Never expose `DEEPGRAM_API_KEY` to the client. The browser uses the
temporary JWT to stream audio directly to Deepgram.

See the
[secure integration guides](https://github.com/VoiceInput/voiceinput/blob/main/docs/vite-hono.md).
