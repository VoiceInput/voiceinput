# Existing fields and forms

VoiceInput edits the field’s draft value; your app still validates and submits
the form. It supports native inputs and textareas, including custom components
that forward their ref to those elements.

The [runnable simulated example](../examples/simulated) exercises these patterns
without accounts or credentials. Real applications use an official provider and
an authenticated server token route.

## Existing composer or shadcn textarea

Use the headless hook when your application already owns its textarea, styling
and submit flow. A shadcn textarea works when it forwards its ref to the native
textarea. Keep AI SDK message sending in the application's existing submit
handler; VoiceInput only edits the draft.

The following excerpt belongs inside your existing composer component. Import
`useVoiceInput` from `@voiceinput/react`; `Textarea`, `message`, `setMessage`,
and `voiceProvider` are your existing component, state, and provider.

```tsx
const { targetRef, getTriggerProps, status, error } = useVoiceInput({
  provider: voiceProvider,
  value: message,
  onValueChange: setMessage,
});

return (
  <>
    <Textarea
      ref={targetRef}
      value={message}
      onChange={(event) => setMessage(event.currentTarget.value)}
    />
    <button {...getTriggerProps()}>
      {status === "idle" ? "Speak" : "Stop"}
    </button>
    {error ? <p role="alert">{error.message}</p> : null}
  </>
);
```

For an optional controlled wrapper,
`<VoiceTextarea value={message} onValueChange={setMessage} voice={{ provider: voiceProvider }} />`
handles both typing and dictation. A second state setter in `onChange` is
unnecessary.

## React Hook Form

Install the form library if your app does not already use it:

**npm**

```bash
npm install react-hook-form
```

**pnpm**

```bash
pnpm add react-hook-form
```

Import `useForm` and `Controller` from `react-hook-form`, and `VoiceTextarea`
from `@voiceinput/react`. Native change events let an uncontrolled wrapper
participate in registration. This excerpt belongs inside your form component:

```tsx
const { register, handleSubmit, reset, formState } = useForm({
  defaultValues: { message: "" },
  mode: "onChange",
});

return (
  <form onSubmit={handleSubmit(onSubmit)}>
    <VoiceTextarea
      {...register("message", { required: true, minLength: 5 })}
      voice={{ provider: voiceProvider }}
      maxLength={500}
    />
    <button type="submit">Submit</button>
    <button type="button" onClick={() => reset()}>
      Reset
    </button>
  </form>
);
```

### Controlled form example

For controlled forms, use `Controller` and map `field.value` and
`field.onChange` to the wrapper's `value` and `onValueChange`, while forwarding
`field.ref`, `field.name`, and `field.onBlur`. Do not pass the same form updater
to both `onChange` and `onValueChange`.

The simulated form verifies validation, dirty state, submitted text, reset and
disabled behavior. See the [editing contract](editing-contract.md) for
limitations, length notifications and the distinction between recognized and
inserted text.

```tsx
import { Controller, useForm } from "react-hook-form";
import { VoiceTextarea } from "@voiceinput/react";
import { openai } from "@voiceinput/openai";

const provider = openai({ tokenEndpoint: "/api/voice-token" });
type FormValues = { message: string };

export function MessageForm({
  onSubmit,
}: {
  onSubmit: (values: FormValues) => void;
}) {
  const { control, handleSubmit } = useForm<FormValues>({
    defaultValues: { message: "" },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Controller
        name="message"
        control={control}
        rules={{ required: "Enter a message." }}
        render={({ field, fieldState }) => (
          <>
            <VoiceTextarea
              ref={field.ref}
              name={field.name}
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              voice={{ provider }}
              aria-label="Message"
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.error ? "message-error" : undefined}
            />
            {fieldState.error && (
              <p id="message-error" role="alert">
                {fieldState.error.message}
              </p>
            )}
          </>
        )}
      />
      <button type="submit">Send message</button>
    </form>
  );
}
```

In Next.js, add `"use client"` at the top of this component. Configure the
[authenticated token route](quickstart.md#3-create-the-token-route) before
trying real dictation. Type and dictate into the field, then submit: both kinds
of edits should reach `onSubmit` through the same form value.
