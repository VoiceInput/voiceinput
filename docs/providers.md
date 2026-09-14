# Choose a provider

Choose OpenAI, ElevenLabs, or Deepgram, then install its package beside
`@voiceinput/react`. Your provider handles transcription and billing; VoiceInput
handles field interaction.

| Provider   | Package                  | Server key           | Setup                                                |
| ---------- | ------------------------ | -------------------- | ---------------------------------------------------- |
| OpenAI     | `@voiceinput/openai`     | `OPENAI_API_KEY`     | [OpenAI guide](../packages/openai/README.md)         |
| ElevenLabs | `@voiceinput/elevenlabs` | `ELEVENLABS_API_KEY` | [ElevenLabs guide](../packages/elevenlabs/README.md) |
| Deepgram   | `@voiceinput/deepgram`   | `DEEPGRAM_API_KEY`   | [Deepgram guide](../packages/deepgram/README.md)     |

All integrations use an authenticated server route to exchange the long-lived
key for a temporary or single-use browser credential. The browser then streams
audio directly to the provider. See [how it works](overview.md#how-it-works).

## Provider differences

| Behavior              | OpenAI                              | ElevenLabs           | Deepgram                                                |
| --------------------- | ----------------------------------- | -------------------- | ------------------------------------------------------- |
| Default model         | `gpt-transcribe`                    | `scribe_v2_realtime` | `nova-3`                                                |
| PCM16 sample rate     | 24 kHz                              | 16 kHz               | 16 kHz                                                  |
| Omitted language      | Automatic                           | Automatic            | `multi` on multilingual Nova models; otherwise required |
| Vocabulary            | Prompt, or keywords for live models | Key terms            | Nova-3 key terms                                        |
| Omitted `endpointing` | Server VAD, 500 ms silence          | VAD, 650 ms silence  | Provider default                                        |
| `endpointing: false`  | Manual commit                       | Manual commit        | Disables endpointing                                    |

`gpt-live-transcribe` requires `endpointing: false`. The OpenAI default supports
server phrase boundaries.

Adapters validate shared options before asking for microphone permission.
Malformed settings produce `invalid-configuration`; settings the selected
provider cannot honor produce `unsupported-feature`.

## Switch providers

Change the package, browser factory, server handler, and server environment
variable. The hook, field state, and button stay the same. When overriding a
model, configure the same model in the browser factory and server handler.

Provider language support, pricing, latency, and retention differ. Read the
selected package guide before overriding language, vocabulary, endpointing, or
model settings. To integrate another service,
[write a custom provider](custom-provider.md).
