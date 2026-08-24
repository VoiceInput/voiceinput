# `@voiceinput/provider`

Versioned contracts and test utilities for VoiceInput adapters. Application
authors normally receive this package through `@voiceinput/react`; adapter
authors use it directly.

## Install

```bash
npm install @voiceinput/provider
```

## Provider contract

```ts
import type { VoiceInputProviderV1 } from "@voiceinput/provider";

const provider: VoiceInputProviderV1 = {
  specificationVersion: "v1",
  provider: "acme",
  modelId: "acme-realtime-1",
  sampleRate: 16_000,

  validateOptions(options) {
    // Synchronously reject unsupported shared options before recording.
  },

  async doOpen(options) {
    // Return a session that accepts mono PCM16 and emits normalized parts.
  },
};
```

`validateOptions` must be synchronous. `doOpen` receives the same transcription
options plus an `AbortSignal`. A session owns:

- `stream`: terminal `ReadableStream<VoiceInputProviderV1StreamPart>`
- `sendAudio(Int16Array)`: mono PCM16 at the declared sample rate
- `finish()`: graceful and idempotent
- `abort(reason?)`: immediate and idempotent

Normal stream completion is terminal. Provider failures should be emitted as a
normalized error part before closure.

## Portable transcription options

| Option                                         | Meaning                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `language?: string`                            | BCP 47 language hint; omission asks for provider auto-detection                     |
| `vocabulary?: readonly string[]`               | Domain terms; adapters document their real provider mapping                         |
| `endpointing?: false \| { silenceMs: number }` | Provider default when omitted, manual/disabled when `false`, or a silence threshold |

An adapter must reject an unsupported option with `VoiceInputError`; it must not
silently ignore or approximate it.

## Normalized stream parts

```ts
type VoiceInputProviderV1StreamPart =
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "speech-start" }
  | { type: "speech-end" }
  | { type: "error"; error: VoiceInputError };
```

## Errors

`VoiceInputError` is safe to recognize across realms with
`VoiceInputError.isInstance(value)`. It preserves the original `cause` and
exposes:

- `code`: stable `VoiceInputErrorCode`
- `provider?: string`
- `retryable: boolean`
- `retryAfterMs?: number`

Error codes are `unsupported-browser`, `permission-denied`, `device-not-found`,
`device-busy`, `unauthorized`, `rate-limited`, `token-error`, `network-error`,
`provider-error`, `unsupported-feature`, `invalid-configuration`, `audio-error`,
and `transform-error`.

## Test export

Import deterministic utilities from the separate test entry point:

```ts
import {
  createFakeVoiceInputProvider,
  createVoiceInputProviderV1ConformanceCases,
} from "@voiceinput/provider/test";
```

The fake provider returns `{ provider, controller }`. The controller can wait
for sessions, resolve or reject opening, emit normalized parts, close or fail a
stream, and inspect immutable session snapshots.

The conformance runner is framework-independent:

```ts
const cases = createVoiceInputProviderV1ConformanceCases({
  createHarness: createMyDeterministicAdapterHarness,
});

for (const testCase of cases) {
  await testCase.run();
}
```

Your harness supplies the adapter under test and a controller for its fake
transport. See the
[custom-provider guide](https://github.com/VoiceInput/voiceinput/blob/main/docs/custom-provider.md).

## Public API

Main entry point:

- `VoiceInputError`
- `VoiceInputErrorCode`, `VoiceInputErrorOptions`
- `VoiceEndpointingOptions`, `VoiceTranscriptionOptions`
- `VoiceInputProviderV1`
- `VoiceInputProviderV1CallOptions`
- `VoiceInputProviderV1Session`
- `VoiceInputProviderV1StreamPart`

`@voiceinput/provider/test`:

- `createFakeVoiceInputProvider`
- `createVoiceInputProviderV1ConformanceCases`
- `VoiceInputProviderConformanceError`
- `FakeVoiceInputProvider`
- `FakeVoiceInputProviderOptions`
- `FakeVoiceInputProviderController`
- `FakeVoiceInputProviderSessionSnapshot`
- `VoiceInputProviderV1ConformanceHarness`
- `VoiceInputProviderV1ConformanceCase`
- `VoiceInputProviderV1ConformanceOptions`

## Security boundary

This package contains no credential handling. Official adapters expose browser
code from their root and token minting from a separate `/server` export. Custom
adapters should preserve the same boundary: long-lived credentials must never
enter browser code, payloads, or logs.
