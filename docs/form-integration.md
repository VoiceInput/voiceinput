# Existing composers and forms

The [runnable simulated example](../examples/simulated) exercises these patterns
without accounts or credentials. Real applications use an official provider and
an authenticated server token route.

## Existing composer or shadcn textarea

Use the headless hook when your application already owns its textarea, styling
and submit flow. A shadcn textarea works when it forwards its ref to the native
textarea. Keep AI SDK message sending in the application's existing submit
handler; VoiceInput only edits the draft.

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

Native change events let an uncontrolled wrapper participate in registration:

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

For controlled forms, use `Controller` and map `field.value` and
`field.onChange` to the wrapper's `value` and `onValueChange`, while forwarding
`field.ref`, `field.name`, and `field.onBlur`. Do not pass the same form updater
to both `onChange` and `onValueChange`.

The simulated form verifies validation, dirty state, submitted text, reset and
disabled behavior. See the [editing contract](editing-contract.md) for
limitations, length notifications and the distinction between recognized and
inserted text.
