# `@voiceinput/openai`

Use OpenAI Realtime transcription with VoiceInput. Keep the long-lived provider
key on the server and give the browser a temporary credential through an
authenticated route. Follow the [quickstart](../../docs/quickstart.md) for a
complete application.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/openai
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/openai
```

## Browser adapter

```ts
import { openai } from "@voiceinput/openai";

const provider = openai({
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
  rateLimit: async ({ subject }) => {
    return (await underQuota(subject))
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: 60 };
  },
});
```

`underQuota(subject)` represents your app’s shared rate limiter. Use the
[Upstash recipe](../../docs/authentication-recipes.md#durable-upstash-quota) or
your existing quota store.

The handler accepts only `POST`, always requires `authorize`, sends
`Cache-Control: no-store`, and never returns or logs the long-lived API key.
Returning `null` from `authorize` produces `401`. A denied `rateLimit` produces
`429` before a provider credential is issued. Requests must be JSON and are
limited to 16 KiB. Authorization and rate-limit callbacks receive independent
request bodies. If `onTokenIssued` throws, credential delivery fails closed.

### `CreateOpenAITokenHandlerOptions`

| Option                      | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `apiKey`                    | Required server-only OpenAI key                                     |
| `authorize(request)`        | Required application authorization; returns `{ subject }` or `null` |
| `model`                     | Default model; default `gpt-transcribe`                             |
| `allowedModels`             | Models a browser request may select; defaults to only `model`       |
| `organization`, `project`   | Optional OpenAI request headers                                     |
| `safetyIdentifier(context)` | Optional per-subject OpenAI safety identifier                       |
| `rateLimit(context)`        | Optional application quota check                                    |
| `onTokenIssued(metadata)`   | Metadata-only callback with subject, model, and expiry              |
| `fetch`, `providerTokenUrl` | Transport/endpoint overrides                                        |

Callback context uses `VoiceTokenHandlerContext` from `@voiceinput/provider`.
`OpenAITokenIssuedMetadata` contains `provider: "openai"`, `subject`, `model`,
and `expiresAt` as epoch milliseconds.

The default commits separate phrases during a recording, allowing undo and
correction to work at phrase boundaries. `gpt-live-transcribe` requires
`endpointing: false` and commits one segment when recording stops.

## Transcription options

Start with the defaults. `language` hints at the spoken language, `vocabulary`
helps recognize specific terms, and `endpointing` controls when a pause ends a
phrase. Set these shared options on the React hook or under a control’s `voice`
prop. Provider-only options belong in the browser factory.

### Defaults and shared-option mapping

- Model: `gpt-transcribe` (`OPENAI_DEFAULT_MODEL`)
- Audio: mono PCM16 at 24 kHz
- Omitted language: provider automatic detection
- `language`: normalized to its ISO 639-1 primary language code
- `vocabulary`: `keywords` for `gpt-live-transcribe*` models; a transcription
  prompt for committed-turn transcription models
- `endpointing`: server VAD with 500 ms silence when omitted, manual commit when
  `false`, or server VAD with the requested `silence_duration_ms`
- `gpt-live-transcribe*`: manual commit only; omitted endpointing maps to
  `null`. Explicit server endpointing returns `unsupported-feature`.

Vocabulary accepts at most 100 trimmed terms, each at most 200 characters and
without angle brackets or line breaks.

### `OpenAIVoiceInputProviderOptions`

| Option          | Purpose                                                            |
| --------------- | ------------------------------------------------------------------ |
| `tokenEndpoint` | Required same-origin endpoint that returns an ephemeral credential |
| `model`         | Model ID; default `gpt-transcribe`                                 |
| `fetch`         | Test/runtime override for `globalThis.fetch`                       |
| `webSocket`     | Test/runtime override for `globalThis.WebSocket`                   |
| `realtimeUrl`   | Realtime WebSocket URL override                                    |

The last three options are provider-factory escape hatches, primarily useful for
controlled infrastructure and deterministic tests.

## Public API

Browser root:

- `openai(options)`
- `OPENAI_DEFAULT_MODEL`
- `OpenAIVoiceInputProviderOptions`

Server-only entry point:

- `createOpenAITokenHandler(options)`
- `CreateOpenAITokenHandlerOptions`
- `OpenAITokenIssuedMetadata`

Shared authorization, rate-limit, handler-context, and issued-metadata types
come from `@voiceinput/provider`.

## Security

Import `/server` only from server code. The package export is disabled under the
browser condition. Never place `OPENAI_API_KEY` in a public environment variable
or send it to `openai()`. The browser adapter obtains an ephemeral credential
from your authenticated endpoint and then streams audio directly to OpenAI.

See [how VoiceInput works](../../docs/overview.md#how-it-works) for the complete
credential and audio security boundary.
