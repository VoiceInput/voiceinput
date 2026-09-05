# Choose a provider

VoiceInput connects to OpenAI, ElevenLabs, or Deepgram using your provider
account. Start with a provider you already use. Your provider handles
transcription and bills its API usage; VoiceInput handles the field interaction.

## Packages and setup

| Provider   | Install alongside `@voiceinput/react` | Server environment variable | Setup                                                |
| ---------- | ------------------------------------- | --------------------------- | ---------------------------------------------------- |
| OpenAI     | `@voiceinput/openai`                  | `OPENAI_API_KEY`            | [OpenAI guide](../packages/openai/README.md)         |
| ElevenLabs | `@voiceinput/elevenlabs`              | `ELEVENLABS_API_KEY`        | [ElevenLabs guide](../packages/elevenlabs/README.md) |
| Deepgram   | `@voiceinput/deepgram`                | `DEEPGRAM_API_KEY`          | [Deepgram guide](../packages/deepgram/README.md)     |

All three integrations need an authenticated server route that issues a
temporary credential. Keep the long-lived API key on the server.

## What changes when you switch

Change the installed provider package, the browser factory, the server token
handler, and its environment variable. Keep your textarea, React state, and
`useVoiceInput` integration.

For example, replace `openai(...)` with `deepgram(...)`, then use
`createDeepgramTokenHandler` in the server route. Install the new adapter first.
If you customize the model, configure the same model on both sides.

## Provider differences

The shared API exposes language, vocabulary hints, and phrase detection
(`endpointing`). Providers support different settings and may return text at
different times. Read the provider guide before overriding those options.

| Behavior                              | Where to check                                                            |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Model defaults and supported settings | Each provider's configuration reference                                   |
| Languages and vocabulary limits       | Each provider's shared-option mapping                                     |
| When a phrase becomes final           | Provider endpointing settings and [editing behavior](editing-contract.md) |
| Usage charges and audio retention     | Your provider's account settings and agreement                            |

Invalid settings fail before microphone permission is requested. VoiceInput
reports unsupported options instead of silently ignoring them. If you need a
different transcription service, follow [Custom providers](custom-provider.md).
