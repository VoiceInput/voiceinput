# Write a custom provider

VoiceInput adapters implement the public `VoiceInputProviderV1` contract. The
contract is deliberately small: validate portable settings, open one streaming
session, accept mono PCM16, and emit normalized transcript parts.

## 1. Create a typed factory

Provider-only model and transport settings belong in the factory. Shared
`language`, `vocabulary`, and `endpointing` settings arrive later in
`validateOptions` and `doOpen`.

```ts
import {
  VoiceInputError,
  type VoiceInputProviderV1,
  type VoiceTranscriptionOptions,
} from "@voiceinput/provider";

export interface AcmeVoiceInputOptions {
  tokenEndpoint: string | URL;
  model?: string;
  fetch?: typeof globalThis.fetch;
  webSocket?: typeof globalThis.WebSocket;
}

export function acme(options: AcmeVoiceInputOptions): VoiceInputProviderV1 {
  const model = options.model ?? "acme-realtime-1";

  const validateOptions = (shared: VoiceTranscriptionOptions): void => {
    if (shared.endpointing === false) {
      throw new VoiceInputError({
        code: "unsupported-feature",
        message: "Acme does not support manual endpointing.",
        provider: "acme",
      });
    }
  };

  return Object.freeze({
    specificationVersion: "v1",
    provider: "acme",
    modelId: model,
    sampleRate: 16_000,
    validateOptions,

    async doOpen(callOptions) {
      validateOptions(callOptions);
      // 1. Fetch a short-lived credential from options.tokenEndpoint.
      // 2. Open the provider transport with callOptions.abortSignal.
      // 3. Map provider output into the normalized session below.
      return createAcmeSession({
        abortSignal: callOptions.abortSignal,
        model,
      });
    },
  });
}
```

Validation must be synchronous so invalid or unsupported settings fail before
microphone permission. Do not accept and discard an option.

## 2. Return a normalized session

```ts
import {
  VoiceInputError,
  type VoiceInputProviderV1Session,
  type VoiceInputProviderV1StreamPart,
} from "@voiceinput/provider";

interface AcmeTransport {
  sendAudio(chunk: Int16Array): void;
  finish(): void;
  close(reason?: unknown): void;
}

declare function openAcmeTransport(options: {
  model: string;
  onPart(part: VoiceInputProviderV1StreamPart): void;
  onClose(): void;
  onError(cause: unknown): void;
}): AcmeTransport;

function createAcmeSession(options: {
  abortSignal: AbortSignal;
  model: string;
}): VoiceInputProviderV1Session {
  let controller:
    ReadableStreamDefaultController<VoiceInputProviderV1StreamPart> | undefined;
  let closed = false;
  let finishing = false;
  let transport: AcmeTransport | undefined;

  const stream = new ReadableStream<VoiceInputProviderV1StreamPart>({
    start(value) {
      controller = value;
    },
  });

  const handleAbort = (): void => abort(options.abortSignal.reason);

  const closeStream = (): void => {
    if (closed) return;
    closed = true;
    options.abortSignal.removeEventListener("abort", handleAbort);
    controller?.close();
  };

  function abort(reason?: unknown): void {
    if (closed) return;
    transport?.close(reason);
    closeStream();
  }

  const fail = (cause: unknown): void => {
    if (closed) return;
    const error = VoiceInputError.isInstance(cause)
      ? cause
      : new VoiceInputError({
          code: "provider-error",
          message: "The Acme realtime session failed.",
          provider: "acme",
          cause,
        });
    controller?.enqueue({ type: "error", error });
    abort(error);
  };

  transport = openAcmeTransport({
    model: options.model,
    onPart(part) {
      if (!closed) controller?.enqueue(part);
    },
    onClose: closeStream,
    onError: fail,
  });

  if (options.abortSignal.aborted) {
    abort(options.abortSignal.reason);
  } else {
    options.abortSignal.addEventListener("abort", handleAbort, { once: true });
  }

  return {
    stream,
    sendAudio(chunk) {
      if (!closed && !finishing) transport?.sendAudio(chunk);
    },
    finish() {
      if (closed || finishing) return;
      finishing = true;
      try {
        transport?.finish();
      } catch (cause) {
        fail(cause);
      }
    },
    abort,
  };
}
```

The provider-specific `openAcmeTransport` maps real protocol events to
normalized parts and invokes `onClose` only after graceful finalization.
Production code must also reject malformed provider events. A normal stream
close is terminal; `finish` and `abort` remain idempotent.

## 3. Preserve the credential boundary

Expose browser code from your package root and token minting from a separate
`/server` export. The browser factory receives only a token endpoint. The server
handler should:

- use standard `Request` and `Response`
- require application authorization
- optionally call the application's rate limiter
- return only a short-lived, scoped, or single-use credential
- set `Cache-Control: no-store`
- never return or log the long-lived provider key

Mark the `/server` package export with a disabled browser condition, matching
the official provider packages.

## 4. Run deterministic conformance cases

```ts
import { createVoiceInputProviderV1ConformanceCases } from "@voiceinput/provider/test";
import { describe, expect, it } from "vitest";

describe("Acme provider conformance", () => {
  const cases = createVoiceInputProviderV1ConformanceCases({
    createHarness: createAcmeConformanceHarness,
  });

  for (const testCase of cases) {
    it(testCase.name, async () => {
      await expect(testCase.run()).resolves.toBeUndefined();
    });
  }
});
```

`createAcmeConformanceHarness` should construct the real adapter against a fake
token endpoint and fake transport, then expose a controller implementing
`FakeVoiceInputProviderController`. The public cases verify metadata, ordered
normalized output, PCM16 delivery, idempotent finish/abort, normalized errors,
and terminal closure.

Add provider-specific tests for event mapping, option limits, credential
responses, close codes, rate limits, and delayed final results. The official
adapter tests are useful reference implementations.

## 5. Integrate without application branching

Once the adapter returns `VoiceInputProviderV1`, React code is unchanged:

```tsx
<VoiceInputProvider provider={acme({ tokenEndpoint: "/api/voice-token" })}>
  <Composer />
</VoiceInputProvider>
```

Provider neutrality applies to the field/session contract. Document differences
in pricing, latency, supported languages, vocabulary semantics, retention, and
endpointing rather than hiding them.
