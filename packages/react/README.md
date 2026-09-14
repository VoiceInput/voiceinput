# `@voiceinput/react`

Add dictation to an existing React field with `useVoiceInput`, or use the
included controls. React 18.2+ or 19 is supported. Start with the
[quickstart](../../docs/quickstart.md) to add the server token route.

## Install

**npm**

```bash
npm install @voiceinput/react @voiceinput/openai
```

**pnpm**

```bash
pnpm add @voiceinput/react @voiceinput/openai
```

## Headless hook

Keep the field's ordinary `onChange` handler and give the hook the same value.
Pass a provider directly when the field does not use shared context.

```tsx
import { openai } from "@voiceinput/openai";
import { useVoiceInput } from "@voiceinput/react";
import { useState } from "react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Composer() {
  const [value, setValue] = useState("");
  const voice = useVoiceInput({
    provider,
    value,
    onValueChange: setValue,
    language: "en-CA",
    vocabulary: ["VoiceInput"],
  });
  const active = voice.status !== "idle" && voice.status !== "error";

  return (
    <>
      <textarea
        aria-label="Message"
        ref={voice.targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button {...voice.getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
    </>
  );
}
```

`getTriggerProps()` supplies the button's click, pointer, keyboard, blur,
disabled, type, and `aria-pressed` behavior. Pass application button props to
compose handlers safely:

```tsx
<button
  {...voice.getTriggerProps({
    onClick(event) {
      if (!formIsReady) event.preventDefault();
    },
  })}
>
  Speak
</button>
```

Application handlers run first. Calling `preventDefault()` skips the VoiceInput
handler.

For an uncontrolled target, omit both `value` and `onValueChange`. VoiceInput
then updates the DOM value and dispatches a bubbling native `input` event.

## Hook result

`useVoiceInput()` returns:

- `targetRef` for the input or textarea
- `getTriggerProps(buttonProps?)` for a trigger button
- `status`, `transcript`, `interimTranscript`, `finalTranscript`, and `error`
- `isSupported`
- `start()`, `stop(reason?)`, `cancel()`, and `toggle()`
- `undo()` and `redo()` for field-local editing transactions
- `getTextSnapshot()` for the current selection and voice-owned spans

Status values are `idle`, `requesting-permission`, `connecting`, `listening`,
`stopping`, `processing`, and `error`.

Raw provider parts reach `onInterimTranscript` and `onFinalTranscriptPart`.
`transcript`, `finalTranscript`, `onFinalTranscript`, and `onTranscriptChange`
expose cumulative normalized text.

## Hook options

| Option                    | Purpose                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `provider`, `audioSource` | Override context configuration                                                                                          |
| `value`, `onValueChange`  | Controlled text binding; supply both or neither                                                                         |
| `language`                | BCP 47 language hint                                                                                                    |
| `vocabulary`              | Domain terms mapped by the selected adapter                                                                             |
| `endpointing`             | Provider default, `false`, or `{ silenceMs }`; see [provider differences](../../docs/providers.md#provider-differences) |
| `connectionTimeoutMs`     | Provider connection deadline after audio acquisition; default 15 seconds                                                |
| `finalizationTimeoutMs`   | Audio and provider shutdown deadline; default 15 seconds                                                                |
| `stopWhenHidden`          | Stop when the page becomes hidden; default `true`                                                                       |
| `maxDurationMs`           | Positive finite duration; default five minutes                                                                          |
| `interimBehavior`         | `"inline"` (default) or `"expose"`                                                                                      |
| `transformTranscript`     | Sync or async post-stop transform for unedited voice-owned spans                                                        |
| `transformTimeoutMs`      | Transform deadline; default 10 seconds                                                                                  |
| `activationMode`          | `"toggle"` (default) or `"hold"`                                                                                        |
| `disabled`                | Prevent activation and stop active recording                                                                            |
| `onTextLimit`             | Called when an insertion reaches the field's `maxLength`                                                                |
| `onEvent`                 | Receive every normalized session event                                                                                  |
| `onStatusChange`          | Receive current and previous status                                                                                     |
| `onInterimTranscript`     | Receive the current raw interim part                                                                                    |
| `onFinalTranscriptPart`   | Receive each raw provider-final part                                                                                    |
| `onFinalTranscript`       | Receive cumulative normalized final text                                                                                |
| `onTranscriptChange`      | Receive cumulative normalized text, including interim text                                                              |
| `onDurationWarning`       | Called before the maximum-duration cutoff                                                                               |
| `onStop`, `onError`       | Terminal callbacks                                                                                                      |

Create provider objects once at module scope or memoize them. Provider and
recording options are sampled when the next recording starts; changing them does
not interrupt an active recording.

## Components

The optional controls work with context or accept a provider under `voice`.
Controlled wrappers need only `value` and `onValueChange`; that callback handles
both typing and dictation. A second state setter is unnecessary.

### `VoiceButton`

```tsx
<VoiceButton voice={{ activationMode: "toggle" }} className="my-button">
  {(voice) => (voice.status === "listening" ? "Stop" : "Speak")}
</VoiceButton>
```

`VoiceButton` forwards native button props and its ref. Hook options live under
`voice`. Its children can be a React node or a render function that receives the
hook result. Pass `announce={false}` to disable the built-in live region, or use
`getAnnouncement` to customize its text.

### `VoiceInput` and `VoiceTextarea`

```tsx
<VoiceInput
  type="search"
  defaultValue="Search notes"
  voiceButtonProps={{ "aria-label": "Dictate search" }}
/>

<VoiceTextarea
  value={message}
  onValueChange={setMessage}
  voice={{ vocabulary: ["VoiceInput"] }}
/>
```

Both controls forward native field props and refs. They add:

- `voice`: hook options except `value` and `onValueChange`
- `value` and `onValueChange`: controlled text binding
- `containerClassName`: class on the field and button wrapper
- `voiceButtonProps`: native button props plus render children and announcements

`VoiceInput` accepts selection-capable types: `text`, `search`, `tel`, and
`url`.

Stateful roots and triggers expose:

- `data-voiceinput-active="true|false"`
- `data-voiceinput-error="<code>"` only while an error is present
- `data-voiceinput-status="<status>"`
- `data-voiceinput-supported="true|false"`

## Shared provider context

Use context when several fields should share configuration and coordinate
microphone access. Fields inside it can omit `provider`.

```tsx
"use client";

import { openai } from "@voiceinput/openai";
import { VoiceInputProvider } from "@voiceinput/react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <VoiceInputProvider provider={provider}>{children}</VoiceInputProvider>
  );
}
```

`VoiceInputProvider` accepts `provider`, an optional custom `audioSource`, and
`children`. It allows one active microphone session among its descendants.

## Styles

```ts
import "@voiceinput/react/styles.css";
```

No code path imports CSS automatically. The optional theme uses:

- `--voiceinput-accent`, `--voiceinput-accent-strong`
- `--voiceinput-surface`, `--voiceinput-surface-active`
- `--voiceinput-text`, `--voiceinput-muted`, `--voiceinput-danger`
- `--voiceinput-radius`, `--voiceinput-focus`
- `--voiceinput-shadow`, `--voiceinput-shadow-hover`

Override them at `:root` or on a containing element. The controls remain
functional without the stylesheet.

## Accessibility

- Toggle mode works with native button click, Enter, and Space.
- Hold mode stops on release, cancellation, lost capture, blur, disable, or
  window blur.
- Pointer activation preserves the target selection.
- Triggers expose `aria-pressed`; controls announce status and errors.
- The optional CSS includes visible focus and reduced-motion handling.

If the application owns a live region, pass `announce={false}` and render
`status` and `error` there.

## Public API

Runtime exports:

- `getVoiceInputErrorMessage`, `VoiceInputError`
- `VoiceInputProvider`, `useVoiceInput`
- `VoiceButton`, `VoiceInput`, `VoiceTextarea`

Type exports:

- `VoiceInputProviderProps`
- `UseVoiceInputOptions`, `UseVoiceInputResult`
- `VoiceInputActivationMode`, `VoiceInputTriggerProps`
- `VoiceButtonChildren`, `VoiceButtonProps`, `VoiceFieldButtonProps`
- `VoiceInputProps`, `VoiceTextareaProps`
- `VoiceInputErrorCode`, `VoiceInputStatus`, `VoiceInputStopReason`
- `VoiceInputSessionEvent`, `VoiceInputSnapshot`, `VoiceInputTextLimit`
- `VoiceAudioSource`, `VoiceInputProviderV1`, `VoiceEndpointingOptions`
- `VoiceInputInterimBehavior`, `VoiceInputTransformTranscript`
- `VoiceInputTextEngineSnapshot`, `VoiceInputTextTarget`
- `VoiceInputTextSelection`, `VoiceInputTextSpan`, `VoiceInputTextSpanState`

See [editing and undo](../../docs/editing-contract.md) for text ownership,
history, reset behavior, and length limits. See
[how VoiceInput works](../../docs/overview.md#how-it-works) for the credential
and audio security boundary.
