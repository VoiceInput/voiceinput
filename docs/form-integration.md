# Existing fields and forms

VoiceInput edits a field's draft value while your application keeps ownership of
validation, submission, styling, and form state.

## Existing composer or shadcn textarea

```tsx
import { getVoiceInputErrorMessage, useVoiceInput } from "@voiceinput/react";

const voice = useVoiceInput({
  provider: voiceProvider,
  value: message,
  onValueChange: setMessage,
});
const active = voice.status !== "idle" && voice.status !== "error";

return (
  <>
    <Textarea
      ref={voice.targetRef}
      value={message}
      onChange={(event) => setMessage(event.currentTarget.value)}
    />
    <button {...voice.getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
    {voice.error ? (
      <p role="alert">{getVoiceInputErrorMessage(voice.error)}</p>
    ) : null}
  </>
);
```

Use the headless hook when the application already owns the textarea and submit
flow. A custom field such as a shadcn textarea works when it forwards its ref to
the native `textarea`.

## React Hook Form registration

Install React Hook Form if the project does not already use it:

**npm**

```bash
npm install react-hook-form
```

**pnpm**

```bash
pnpm add react-hook-form
```

An uncontrolled `VoiceTextarea` emits native changes and works with
registration:

```tsx
const { register, handleSubmit, reset } = useForm({
  defaultValues: { message: "" },
  mode: "onChange",
});

return (
  <form onSubmit={handleSubmit(onSubmit)}>
    <VoiceTextarea
      {...register("message", { required: true, minLength: 5 })}
      voice={{ provider }}
      maxLength={500}
    />
    <button type="submit">Submit</button>
    <button type="button" onClick={() => reset()}>
      Reset
    </button>
  </form>
);
```

## Controlled form

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
            {fieldState.error ? (
              <p id="message-error" role="alert">
                {fieldState.error.message}
              </p>
            ) : null}
          </>
        )}
      />
      <button type="submit">Send message</button>
    </form>
  );
}
```

`Controller` maps `field.value` and `field.onChange` to the wrapper's `value`
and `onValueChange`, then forwards its ref, name, and blur handler. See the
[React API](../packages/react/README.md#components) for wrapper event behavior
and the [editing contract](editing-contract.md) for resets and length limits.

The [simulated example](../examples/simulated) runs these patterns without a
microphone or provider account.
