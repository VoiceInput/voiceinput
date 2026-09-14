# VoiceInput

VoiceInput adds dictation to React inputs and textareas. People can speak into
the field they are editing, move the cursor, correct text, and undo changes.
Start with the [quickstart](quickstart.md) or an [example](golden-paths.md).

## What you need

| Requirement | Details                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| React       | React 18.2+ or 19                                                                           |
| Provider    | An OpenAI, ElevenLabs, or Deepgram account and API key                                      |
| Server      | An authenticated route that issues temporary credentials; Node.js 22+ for official handlers |
| Browser     | HTTPS, microphone access, `AudioContext`, and `AudioWorklet`                                |

VoiceInput follows 0.x versioning while the API develops. See
[browser and runtime support](support-policy.md) for the current requirements.

## Supported fields

Use a native `textarea` or an `input` with type `text`, `search`, `url`, or
`tel`. Custom fields work when they forward a ref to one of those elements.
Rich-text editors and `contenteditable` are not supported targets.

The headless `useVoiceInput` hook adds behavior to your own field. Optional
`VoiceInput`, `VoiceTextarea`, and `VoiceButton` controls provide ready-made UI.

## How it works

1. The user starts dictation and the browser requests microphone access.
2. Your app asks its authenticated server route for a temporary credential.
3. The server uses its long-lived provider key to obtain that credential.
4. The browser streams audio directly to the provider and inserts returned text.

Keep long-lived keys on your server. VoiceInput does not proxy or persist audio
or transcripts, and the packages send no telemetry to VoiceInput systems.
Provider processing, retention, and billing follow your provider configuration
and agreement.

## Choose an integration

- [Quickstart](quickstart.md): add one field to a Next.js app with OpenAI.
- [Next.js](nextjs.md): configure a route, context, and controlled field.
- [Vite + Hono](vite-hono.md): connect a Vite app to a Node API.
- [Express](express.md): bridge an existing Express server.
- [Existing fields and forms](form-integration.md): integrate custom fields and
  React Hook Form.

You normally install `@voiceinput/react` and one
[provider package](providers.md). The core and provider-contract packages arrive
as dependencies.
