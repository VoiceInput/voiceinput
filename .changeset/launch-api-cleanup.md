---
"@voiceinput/provider": minor
"@voiceinput/core": minor
"@voiceinput/react": minor
"@voiceinput/openai": minor
"@voiceinput/elevenlabs": minor
"@voiceinput/deepgram": minor
---

Prepare the package APIs for 0.1.0. Token handlers now use shared types from
`@voiceinput/provider`:

- `OpenAIAuthorization`, `ElevenLabsAuthorization`, and `DeepgramAuthorization`
  → `VoiceTokenAuthorization`
- `OpenAIRateLimitResult`, `ElevenLabsRateLimitResult`, and
  `DeepgramRateLimitResult` → `VoiceTokenRateLimitResult`
- `OpenAITokenHandlerContext`, `ElevenLabsTokenHandlerContext`, and
  `DeepgramTokenHandlerContext` → `VoiceTokenHandlerContext`

Rename the OpenAI `clientSecretUrl`, ElevenLabs `tokenUrl`, and Deepgram
`grantUrl` handler options to `providerTokenUrl`. Deepgram token callback
metadata now reports `expiresAt` in epoch milliseconds instead of `expiresIn`
seconds, matching OpenAI. OpenAI callback metadata also normalizes its upstream
seconds value to epoch milliseconds.

React trigger bindings move from `triggerProps` → `getTriggerProps()`. React
also re-exports the core text snapshot, target, selection, span, audio source,
transcript transform, interim behavior, and error code types used by React
consumers.
