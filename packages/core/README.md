# `@voiceinput/core`

Framework-neutral voice sessions, browser audio capture, and cursor-safe text
ownership. React applications normally use `@voiceinput/react`, which composes
these primitives.

## Install

```bash
npm install @voiceinput/core
```

## Session

`createVoiceInputSession` coordinates option validation, two-phase audio
startup, provider streaming, duration limits, normalized state, and cleanup.

```ts
import {
  createBrowserAudioSource,
  createVoiceInputSession,
} from "@voiceinput/core";

const session = createVoiceInputSession({
  provider,
  audioSource: createBrowserAudioSource(),
  language: "en-CA",
  vocabulary: ["VoiceInput"],
  endpointing: { silenceMs: 650 },
  connectionTimeoutMs: 15_000,
  maxDurationMs: 5 * 60 * 1_000,
});

const unsubscribe = session.subscribe((event) => {
  console.log(event.type);
});

await session.start();
await session.stop();
unsubscribe();
```

Actions are `start`, `stop`, `cancel`, and `toggle`. `stop` is graceful and
preserves trusted final text; `cancel` aborts immediately. The default maximum
duration is five minutes, with one warning 30 seconds before cutoff.

Once microphone audio is acquired, provider connection and audio activation must
complete within `connectionTimeoutMs` (15 seconds by default). Expiry aborts the
full run, releases acquired audio, reports a retryable `network-error`, and
permits a fresh `start()`.

The immutable snapshot exposes `status`, `transcript`, `interimTranscript`,
`finalTranscript`, and `error`. Status values are `idle`,
`requesting-permission`, `connecting`, `listening`, `stopping`, `processing`,
and `error`. Stop reasons are `user`, `max-duration`, and `replaced`.

Final parts use the same boundary policy as field insertion: outer provider
whitespace is normalized, word boundaries are added when needed, punctuation is
kept adjacent, empty parts are ignored, and consecutive Han, Hiragana, and
Katakana parts are not separated. `finalTranscript` is cumulative; `transcript`
adds the current normalized interim part. Session `final` events expose the raw
provider part as `text` and the cumulative normalized value as `transcript`.

## Audio source lifecycle

`VoiceAudioSource.prepare({ sampleRate, abortSignal, onAcquired })` returns a
`PreparedVoiceAudioSource` with a PCM16 stream plus `start`, `stop`, and
`abort`. Preparation can request permission, but audio delivery starts only
after the provider connects. Custom sources must call the optional
`onAcquired()` callback as soon as they hold live audio resources; this starts
the connection deadline even if later preparation is still pending.

`createBrowserAudioSource` supplies the production browser implementation:

```ts
const audioSource = createBrowserAudioSource({
  constraints: { echoCancellation: true },
  frameDurationMs: 20,
  // Optional: use a self-hosted module under strict CSP.
  workletModuleUrl: "/voiceinput-worklet.js",
});
```

It captures mono audio through an `AudioWorklet`, resamples to the adapter's
declared rate, emits `Int16Array` frames, resumes suspended Safari contexts, and
tears down tracks, nodes, and contexts on every terminal path.

The default worklet uses a temporary Blob URL. For a policy without `blob:`,
write `VOICE_INPUT_AUDIO_WORKLET_SOURCE` to a same-origin JavaScript asset at
build time and pass its URL as `workletModuleUrl`. See the
[Content Security Policy guide](https://github.com/VoiceInput/voiceinput/blob/main/docs/content-security-policy.md)
for the copy script and exact directives.

Use `getBrowserVoiceInputSupport()` for a capability report. It checks secure
context, media devices, `getUserMedia`, `AudioContext`, and `AudioWorklet`.
`normalizeBrowserAudioError(error)` converts browser failures into
`VoiceInputError`.

## Text ownership engine

`createVoiceInputTextEngine` inserts transcript text without taking ownership of
unrelated user content:

```ts
const engine = createVoiceInputTextEngine({
  interimBehavior: "inline",
  transformTranscript: async (text) => text.trim(),
  transformTimeoutMs: 10_000,
});

engine.setTarget(textarea);
engine.captureSelection();
engine.begin();
engine.applyInterim("draft");
engine.applyFinal("final text");
const completion = engine.complete();
await completion.result;
```

Supported targets are `<textarea>` and `<input>` types `text`, `search`, `url`,
and `tel`. The engine tracks provisional, finalized, frozen, and transformed
spans. If a user edits or moves the caret, it freezes text it can no longer
prove ownership of and re-anchors later speech. Uncontrolled targets receive a
bubbling native `input` event.

For a controlled target, provide `getValue` and `onValueChange`, then pass each
committed application value to `reconcileControlledValue`.

`interimBehavior: "inline"` inserts replaceable interim text. `"expose"` keeps
interim text out of the field while still reporting it in snapshots.

## Public API

Session and errors:

- `createVoiceInputSession`
- `VoiceInputSession`, `CreateVoiceInputSessionOptions`
- `VoiceInputSnapshot`, `VoiceInputStatus`, `VoiceInputSessionEvent`
- `VoiceInputStopReason`
- `VoiceAudioSource`, `VoiceAudioSourcePrepareOptions`
- `PreparedVoiceAudioSource`
- `VoiceInputError`, `VoiceInputErrorCode`, `VoiceInputErrorOptions`

Browser audio:

- `createBrowserAudioSource`, `CreateBrowserAudioSourceOptions`
- `getBrowserVoiceInputSupport`
- `BrowserVoiceInputSupport`, `BrowserVoiceInputCapability`
- `normalizeBrowserAudioError`

Text ownership:

- `createVoiceInputTextEngine`, `CreateVoiceInputTextEngineOptions`
- `VoiceInputTextEngine`, `VoiceInputTextEngineSnapshot`
- `VoiceInputTextTarget`
- `VoiceInputTextSelection`
- `VoiceInputTextSpan`, `VoiceInputTextSpanState`
- `VoiceInputControlledTextBinding`
- `VoiceInputInterimBehavior`
- `VoiceInputTransformTranscript`
- `VoiceInputTextCompletion`

## Provider boundary

The session accepts any `VoiceInputProviderV1`. Provider-specific models,
tokens, and settings belong in adapter factories, not core options. See the
[`@voiceinput/provider` guide](https://github.com/VoiceInput/voiceinput/blob/main/packages/provider/README.md)
to implement an adapter.
