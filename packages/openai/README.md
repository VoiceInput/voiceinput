# `@voiceinput/openai`

Use OpenAI to transcribe audio from your React fields. You need a provider API
key and an authenticated server route. The browser uses temporary credentials;
your long-lived key stays on the server.

For a full application example, follow the
[quickstart](../../docs/quickstart.md) or an
[integration guide](../../docs/overview.md#choose-an-integration).

## Install

**npm**

```bash
npm install @voiceinput/react@next @voiceinput/openai@next
```

**pnpm**

```bash
pnpm add @voiceinput/react@next @voiceinput/openai@next
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

Keep this code in a server route. `authenticate(request)` below represents your
existing authentication function, not a VoiceInput export. It must validate the
request and return a user or `null`. For cookie sessions, also validate the
configured origin. Copy the complete route from the
[quickstart](../../docs/quickstart.md#3-create-the-token-route) or use an
[authentication recipe](../../docs/authentication-recipes.md).

```ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";

export const POST = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    const user = await authenticate(request);
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
| `onTokenIssued(metadata)`   | Metadata-only audit callback with subject, model, and expiry        |
| `fetch`, `clientSecretUrl`  | Transport/endpoint overrides                                        |

`OpenAITokenHandlerContext` contains `request`, `subject`, and `model`.
`OpenAITokenIssuedMetadata` contains `provider: "openai"`, `subject`, `model`,
and `expiresAt`.

The default commits separate phrases during a recording, allowing undo and
correction to work at phrase boundaries. Live checks on 2026-09-04 confirmed
that `gpt-live-transcribe` rejects server VAD and does not commit until Stop. It
remains available for earlier interim feedback: set its model in both the
adapter and token handler and use `endpointing: false`. In that mode a recording
is one segment; editing its interim suppresses insertion until the next
recording. See [provider certification](../../docs/provider-certification.md)
for evidence and the latency tradeoff.

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
  `null`. Explicit server endpointing fails with `unsupported-feature` before
  permission.

Vocabulary accepts at most 100 trimmed terms, each at most 200 characters and
without angle brackets or line breaks. Invalid or unsupported settings fail
before microphone permission with distinct error codes.

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
- `OpenAIAuthorization`
- `OpenAIRateLimitResult`
- `OpenAITokenHandlerContext`
- `OpenAITokenIssuedMetadata`

## Security

Import `/server` only from server code. The package export is disabled under the
browser condition. Never place `OPENAI_API_KEY` in a public environment variable
or send it to `openai()`. The browser adapter obtains an ephemeral credential
from your authenticated endpoint and then streams audio directly to OpenAI.

See the
[Next.js](https://github.com/VoiceInput/voiceinput/blob/main/docs/nextjs.md),
[Vite/Hono](https://github.com/VoiceInput/voiceinput/blob/main/docs/vite-hono.md),
and
[Express](https://github.com/VoiceInput/voiceinput/blob/main/docs/express.md)
integration guides.
