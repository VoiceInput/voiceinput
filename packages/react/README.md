# `@voiceinput/react`

Add dictation to your own React field with `useVoiceInput`, or use the optional
controls. The hook manages recording and text insertion while your application
keeps its state, styling, and submit behavior. Start with the
[quickstart](../../docs/quickstart.md) for server setup.

React 18.2+ and React 19 are supported.

## Install

Install this package with one adapter:

**npm**

```bash
npm install @voiceinput/react@next @voiceinput/openai@next
```

**pnpm**

```bash
pnpm add @voiceinput/react@next @voiceinput/openai@next
```

## Headless hook

Use this hook when your app already has a field. Keep the native `onChange`
handler for typing and pass the same state to the hook. No root provider is
required when you pass `provider` directly.

```tsx
import { useVoiceInput } from "@voiceinput/react";
import { useState } from "react";
import { openai } from "@voiceinput/openai";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Composer() {
  const [value, setValue] = useState("");
  const voice = useVoiceInput({
    provider,
    value,
    onValueChange: setValue,
    language: "en-CA",
    vocabulary: ["VoiceInput"],
    activationMode: "toggle",
    interimBehavior: "inline",
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

`getTriggerProps()` supplies click, pointer, keyboard, blur, disabled, type, and
`aria-pressed` behavior while capturing selection before focus changes. Pass
application button props to it instead of relying on object-spread order:

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

Application handlers run first. Calling `preventDefault()` skips VoiceInput's
handler. The lower-level `triggerProps` object remains available when no event
handlers need to be composed.

For an uncontrolled target, omit both `value` and `onValueChange`. Supplying
only one is an invalid configuration. VoiceInput updates the DOM value and
dispatches a bubbling native `input` event.

### `UseVoiceInputOptions`

| Option                    | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `provider`, `audioSource` | Override context configuration                                    |
| `value`, `onValueChange`  | Controlled text binding; supply both or neither                   |
| `language`                | BCP 47 language hint                                              |
| `vocabulary`              | Domain terms mapped by the selected adapter                       |
| `endpointing`             | Provider default, `false`, or `{ silenceMs }`                     |
| `connectionTimeoutMs`     | Provider connection deadline after audio acquisition; default 15s |
| `maxDurationMs`           | Positive finite duration; default five minutes                    |
| `interimBehavior`         | `"inline"` (default) or `"expose"`                                |
| `transformTranscript`     | Sync or async post-stop transform for unedited voice-owned spans  |
| `transformTimeoutMs`      | Transform deadline; default 10 seconds                            |
| `activationMode`          | `"toggle"` (default) or `"hold"`                                  |
| `disabled`                | Prevent activation and stop active recording                      |
| `onTextLimit`             | Called when a voice insertion reaches the field’s `maxLength`     |
| `onEvent`                 | Receive every normalized session event                            |
| `onStatusChange`          | Receive current and previous status                               |
| `onInterimTranscript`     | Current raw interim provider part                                 |
| `onFinalTranscriptPart`   | Each raw provider-final part                                      |
| `onFinalTranscript`       | Cumulative normalized provider-final transcript                   |
| `onTranscriptChange`      | Cumulative normalized transcript, including interim text          |
| `onDurationWarning`       | Called before maximum-duration cutoff                             |
| `onStop`, `onError`       | Terminal callbacks                                                |

### `UseVoiceInputResult`

The hook returns:

- `targetRef`, `triggerProps`, and `isSupported`
- `getTriggerProps(buttonProps?)` for safe application-handler composition
- `undo()` and `redo()` restore field-local editing transactions
- `status`, `transcript`, `interimTranscript`, `finalTranscript`, and `error`
- `start()`, `stop(reason?)`, `cancel()`, and `toggle()`
- `getTextSnapshot()` for the current selection and voice-owned spans

Status values are `idle`, `requesting-permission`, `connecting`, `listening`,
`stopping`, `processing`, and `error`.

Transcript names are intentionally distinct: `onInterimTranscript` and
`onFinalTranscriptPart` receive raw provider parts, while `transcript`,
`finalTranscript`, `onFinalTranscript`, and `onTranscriptChange` expose
cumulative normalized state.

## Shared provider configuration

Use this optional context when multiple fields should share configuration and
coordinate microphone access. Fields inside it can omit their `provider` option.

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

Create provider objects once at module scope, as above, or memoize them.
Provider and recording options are sampled at recording start. Changing provider
identity during a render does not interrupt a running session; the next start
uses the new configuration.

`VoiceInputProvider` accepts `provider`, an optional custom `audioSource`, and
`children`. It coordinates descendants so only one microphone session is active
in that context. Context is optional: pass `provider` and optionally
`audioSource` directly to `useVoiceInput` or a component's `voice` prop.

## Optional controls

The examples below assume the shared provider context above. Without context,
pass a provider under each control’s `voice` prop. Import each control from
`@voiceinput/react`. Controlled wrappers need only `value` and `onValueChange`;
that callback covers typing and dictation.

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
- `VoiceInputError`, `VoiceInputStatus`, `VoiceInputStopReason`
- `VoiceInputSessionEvent`, `VoiceInputSnapshot`
- `VoiceInputProviderV1`, `VoiceEndpointingOptions`

## Security

This package runs in the browser. Give adapters a same-origin token endpoint;
never pass long-lived provider credentials to React props, client environment
variables, or browser bundles. Official server handlers live under each provider
package's `/server` export.

## Editing guarantees and limit notifications

Controlled wrappers require only `value` and `onValueChange`; the callback
covers typing, dictation, undo and redo once per edit. Uncontrolled wrappers
dispatch native input events that React `onChange` and form registration can
observe. `disabled` and `readOnly` are safe mounting states.

`onTextLimit` receives the `text-limit` event: `maxLength`, attempted `text`,
`insertedText`, and `source` (`interim`, `final`, `transform`). Stop reasons
include `max-length`, `target-unavailable`, and `backgrounded` in addition to
the original reasons. Full recognized text remains in transcript callbacks even
when it cannot be inserted.

See [editing behavior and history limits](../../docs/editing-contract.md) and
[form integration](../../docs/form-integration.md). Mobile microphones and
manual screen-reader compatibility remain unverified for this desktop beta.
