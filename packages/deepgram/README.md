# `@voiceinput/deepgram`

Use Deepgram live transcription with VoiceInput. Keep the long-lived provider
key on the server and give the browser a temporary credential through an
authenticated route. Follow the [quickstart](../../docs/quickstart.md) for a
complete application.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/deepgram
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/deepgram
```

## Browser adapter

```ts
import { deepgram } from "@voiceinput/deepgram";

const provider = deepgram({
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
import { createDeepgramTokenHandler } from "@voiceinput/deepgram/server";
import { getCurrentUser } from "@/lib/auth"; // your existing session check

const appOrigin = new URL(process.env.APP_ORIGIN!).origin;

export const POST = createDeepgramTokenHandler({
  apiKey: process.env.DEEPGRAM_API_KEY!,
  ttlSeconds: 30,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});
```

The handler accepts only `POST`, requires authorization, sets
`Cache-Control: no-store`, and returns a temporary token rather than the API
key. Requests must be JSON and are limited to 16 KiB. Authorization and
rate-limit callbacks receive independent request bodies. If `onTokenIssued`
throws, token delivery fails closed.

The default `ttlSeconds` is 30; overrides must be integers from 1 to 3600. Use
the shortest practical lifetime because the token only needs to remain valid for
the WebSocket handshake.

### `CreateDeepgramTokenHandlerOptions`

| Option                      | Purpose                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `apiKey`                    | Required server-only Deepgram key                           |
| `authorize(request)`        | Required application authorization                          |
| `model`                     | Default model; default `nova-3`                             |
| `allowedModels`             | Browser-selectable models; defaults to only `model`         |
| `ttlSeconds`                | Temporary-token lifetime, default 30; 1–3600 seconds        |
| `rateLimit(context)`        | Optional application quota check                            |
| `onTokenIssued(metadata)`   | Metadata-only callback with subject, model, and expiry time |
| `fetch`, `providerTokenUrl` | Transport/endpoint overrides                                |

Callback context uses `VoiceTokenHandlerContext` from `@voiceinput/provider`.
`DeepgramTokenIssuedMetadata` contains `provider: "deepgram"`, `subject`,
`model`, and `expiresAt` as epoch milliseconds.

## Transcription options

Start with the defaults. `language` hints at the spoken language, `vocabulary`
helps recognize specific terms, and `endpointing` controls when a pause ends a
phrase. Set these shared options on the React hook or under a control’s `voice`
prop. Provider-only options belong in the browser factory.

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

## Public API

Browser root:

- `deepgram(options)`
- `DEEPGRAM_DEFAULT_MODEL`
- `DeepgramVoiceInputProviderOptions`

Server-only entry point:

- `createDeepgramTokenHandler(options)`
- `CreateDeepgramTokenHandlerOptions`
- `DeepgramTokenIssuedMetadata`

Shared authorization, rate-limit, handler-context, and issued-metadata types
come from `@voiceinput/provider`.

## Security

Import `/server` only from server code; the export is disabled under the browser
condition. Never expose `DEEPGRAM_API_KEY` to the client. The browser uses the
temporary JWT to stream audio directly to Deepgram.

Deepgram grant tokens carry `usage::write` across core voice APIs rather than a
speech-to-text-only scope. Isolate the backing Member key in a dedicated
project, apply spending controls, and use separate projects and keys for
production and testing. See Deepgram's
[token grant](https://developers.deepgram.com/reference/auth/tokens/grant) and
[authentication guide](https://developers.deepgram.com/guides/fundamentals/token-based-authentication).

See [how VoiceInput works](../../docs/overview.md#how-it-works) for the complete
credential and audio security boundary.
