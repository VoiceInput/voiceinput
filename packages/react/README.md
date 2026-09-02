# `@voiceinput/react`

Headless React voice input plus optional accessible controls. The package wraps
`@voiceinput/core`; it does not implement a separate React transcription path.

React 18.2+ and React 19 are supported.

## Install

Install this package with one adapter:

```bash
npm install @voiceinput/react @voiceinput/openai
```

## Shared provider configuration

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
`children`. It coordinates descendants so only one microphone session is active
in that context. Context is optional: pass `provider` and optionally
`audioSource` directly to `useVoiceInput` or a component's `voice` prop.

## Headless hook

```tsx
import { useVoiceInput } from "@voiceinput/react";
import { useState } from "react";

export function Composer() {
  const [value, setValue] = useState("");
  const voice = useVoiceInput({
    value,
    onValueChange: setValue,
    language: "en-CA",
    vocabulary: ["VoiceInput"],
    activationMode: "toggle",
    interimBehavior: "inline",
  });

  return (
    <>
      <textarea
        ref={voice.targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button {...voice.triggerProps}>Speak</button>
    </>
  );
}
```

Spread `triggerProps` onto a native `<button>`. It captures selection before
focus changes and supplies click, pointer, keyboard, blur, disabled, type, and
`aria-pressed` behavior.

For an uncontrolled target, omit both `value` and `onValueChange`. Supplying
only one is an invalid configuration. VoiceInput updates the DOM value and
dispatches a bubbling native `input` event.

### `UseVoiceInputOptions`

| Option                    | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `provider`, `audioSource` | Override context configuration                                   |
| `value`, `onValueChange`  | Controlled text binding; supply both or neither                  |
| `language`                | BCP 47 language hint                                             |
| `vocabulary`              | Domain terms mapped by the selected adapter                      |
| `endpointing`             | Provider default, `false`, or `{ silenceMs }`                    |
| `maxDurationMs`           | Positive finite duration; default five minutes                   |
| `interimBehavior`         | `"inline"` (default) or `"expose"`                               |
| `transformTranscript`     | Sync or async post-stop transform for unedited voice-owned spans |
| `transformTimeoutMs`      | Transform deadline; default 10 seconds                           |
| `activationMode`          | `"toggle"` (default) or `"hold"`                                 |
| `disabled`                | Prevent activation and release an active hold                    |
| `onEvent`                 | Receive every normalized session event                           |
| `onStatusChange`          | Receive current and previous status                              |
| `onInterimTranscript`     | Current raw interim provider part                                |
| `onFinalTranscriptPart`   | Each raw provider-final part                                     |
| `onFinalTranscript`       | Cumulative normalized provider-final transcript                  |
| `onTranscriptChange`      | Cumulative normalized transcript, including interim text         |
| `onDurationWarning`       | Called before maximum-duration cutoff                            |
| `onStop`, `onError`       | Terminal callbacks                                               |

### `UseVoiceInputResult`

The hook returns:

- `targetRef`, `triggerProps`, and `isSupported`
- `status`, `transcript`, `interimTranscript`, `finalTranscript`, and `error`
- `start()`, `stop(reason?)`, `cancel()`, and `toggle()`
- `getTextSnapshot()` for the current selection and voice-owned spans

Status values are `idle`, `requesting-permission`, `connecting`, `listening`,
`stopping`, `processing`, and `error`.

## Optional controls

### `VoiceButton`

```tsx
<VoiceButton voice={{ activationMode: "toggle" }} className="my-button">
  {(voice) => (voice.status === "listening" ? "Stop" : "Speak")}
</VoiceButton>
```

`VoiceButton` forwards native button props and its ref. Hook options live under
`voice` to avoid collisions with native props. `children` can be a React node or
a render function receiving the full hook result. `announce={false}` disables
the built-in live region; `getAnnouncement` customizes its text.

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
  onChange={(event) => setMessage(event.currentTarget.value)}
  voice={{ vocabulary: ["VoiceInput"] }}
/>
```

Both controls forward native field props and refs. Their VoiceInput additions
are:

- `voice`: hook options except `value` and `onValueChange`
- `value` and `onValueChange`: controlled voice binding
- `containerClassName`: class on the field/button wrapper
- `voiceButtonProps`: native button props plus render children and announcement
  options

`VoiceInput` intentionally accepts only selection-capable types: `text`,
`search`, `tel`, and `url`.

Controls expose these stable attributes on stateful roots and triggers:

- `data-voiceinput-active="true|false"`
- `data-voiceinput-error="<code>"`
- `data-voiceinput-status="<status>"`
- `data-voiceinput-supported="true|false"`

The controls remain fully functional without a stylesheet.

## Optional CSS

Import styles explicitly:

```ts
import "@voiceinput/react/styles.css";
```

No code path imports CSS automatically. The theme uses these custom properties:

- `--voiceinput-accent`, `--voiceinput-accent-strong`
- `--voiceinput-surface`, `--voiceinput-surface-active`
- `--voiceinput-text`, `--voiceinput-muted`, `--voiceinput-danger`
- `--voiceinput-radius`, `--voiceinput-focus`
- `--voiceinput-shadow`, `--voiceinput-shadow-hover`

Override them at `:root` or a containing element. There is no Tailwind runtime
dependency.

## Accessibility and interaction

- Toggle mode works with native button click, Enter, and Space.
- Hold mode starts on primary-pointer/key press and stops on release,
  cancellation, lost capture, blur, disable, or window blur.
- Pointer activation preserves the target selection instead of moving focus.
- Triggers expose `aria-pressed`; controls announce status and errors.
- The optional CSS provides visible focus and reduced-motion handling.

If your application already owns a live region, pass `announce={false}` and
render `status`/`error` in your existing accessibility system.

## Public API

Runtime exports:

- `VoiceInputProvider`
- `useVoiceInput`
- `VoiceButton`
- `VoiceInput`
- `VoiceTextarea`

Type exports:

- `VoiceInputProviderProps`
- `UseVoiceInputOptions`, `UseVoiceInputResult`
- `VoiceInputActivationMode`, `VoiceInputTriggerProps`
- `VoiceButtonChildren`, `VoiceButtonProps`, `VoiceFieldButtonProps`
- `VoiceInputProps`, `VoiceTextareaProps`

## Security

This package runs in the browser. Give adapters a same-origin token endpoint;
never pass long-lived provider credentials to React props, client environment
variables, or browser bundles. Official server handlers live under each provider
package's `/server` export.
