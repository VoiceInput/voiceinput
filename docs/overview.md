# VoiceInput

VoiceInput adds dictation to React inputs and textareas. People can speak into
the field they are editing, move the cursor, correct text, and undo changes. You
keep your field components, styling, and form submission logic.

Start with the [quickstart](quickstart.md), or run an
[example project](golden-paths.md). The simulated example needs no microphone or
provider account.

## What you need

| Requirement            | Details                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| React                  | React 18.2+ within React 18, or React 19                                                              |
| Transcription provider | An OpenAI, ElevenLabs, or Deepgram account and API key                                                |
| Server                 | An authenticated route that issues temporary provider credentials; Node.js 22+ for the server helpers |
| Browser                | Microphone access, AudioWorklet, and HTTPS in production; localhost works for development             |

This is a **desktop beta**. Check
[browser and runtime support](support-policy.md) for tested behavior and
environments that remain unverified. Provider usage is billed by your chosen
provider under your account.

## Supported fields

Use a native `textarea` or an `input` with type `text`, `search`, `url`, or
`tel`. A custom field, including a shadcn textarea, works if it forwards its ref
to one of those native elements. Rich-text editors and `contenteditable` are not
supported targets.

The `useVoiceInput` hook adds voice behavior to your own field. This is the
headless API: it supplies behavior without choosing the appearance. Optional
`VoiceInput`, `VoiceTextarea`, and `VoiceButton` controls provide ready-made UI.

## How it works

1. The user presses the voice button. The browser asks for microphone access.
2. Your app requests a temporary credential from your authenticated server
   route.
3. Your server uses its provider API key to obtain that credential.
4. The browser sends audio directly to the provider and inserts returned text.

Keep the long-lived API key on your server. VoiceInput does not proxy or store
audio or transcripts, and the SDK sends no telemetry to VoiceInput systems.
Audio processing and retention depend on your provider settings and agreement.

The website’s live demo uses a server relay to enforce its recording and usage
limits. Demo audio passes through that relay to OpenAI; the demo does not store
audio or transcripts. Your own SDK integration uses the direct connection above.

## Choose an integration

- [Quickstart](quickstart.md): add one field to a Next.js app using OpenAI.
- [Next.js](nextjs.md): configure server routes and multiple fields.
- [Vite + Hono](vite-hono.md): connect a Vite app to a Node API.
- [Express](express.md): use your existing Express server.
- [Existing fields and forms](form-integration.md): integrate a custom field or
  React Hook Form.

You normally install `@voiceinput/react` and one provider package. The core and
provider-contract packages are included as dependencies. See
[provider setup](providers.md) to choose or switch providers.
