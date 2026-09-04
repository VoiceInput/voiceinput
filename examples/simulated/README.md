# Simulated VoiceInput examples

Run from the repository root:

```sh
pnpm install
pnpm build
pnpm --filter @voiceinput/example-simulated dev
```

Open http://127.0.0.1:5174. This example generates a known transcript and never
requests a microphone, connects to a provider, or needs an account/API key.

The first field demonstrates a headless composer with ordinary controlled React
state. The second uses an uncontrolled `VoiceTextarea` registered with React
Hook Form, including validation, dirty state, reset and submission. Both are
covered by desktop Chromium, Firefox and WebKit end-to-end tests.

To add real transcription, replace `provider` with an official adapter, remove
`audioSource: simulatedAudio`, and add your authenticated token route. Follow
the root README and authentication guide; the simulator is not an authentication
example or a transcription-quality demonstration.
