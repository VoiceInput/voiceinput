import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { useVoiceInput, VoiceTextarea } from "@voiceinput/react";
import { createSimulation, simulatedAudio } from "./simulation.js";
import "./style.css";

const provider = createSimulation();

function Composer() {
  const [value, setValue] = useState("");
  const { targetRef, getTriggerProps, status, undo, redo } = useVoiceInput({
    provider,
    audioSource: simulatedAudio,
    value,
    onValueChange: setValue,
  });
  return (
    <section>
      <h2>Your existing textarea</h2>
      <label htmlFor="composer">Message</label>
      <textarea
        id="composer"
        ref={targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="actions">
        <button {...getTriggerProps()}>
          {status === "idle" ? "Speak" : "Stop"}
        </button>
        <button onClick={() => undo()}>Undo</button>
        <button onClick={() => redo()}>Redo</button>
      </div>
      <output>{status}</output>
    </section>
  );
}

function SupportForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<{ message: string }>({
    defaultValues: { message: "" },
    mode: "onChange",
  });
  const [disabled, setDisabled] = useState(false);
  const [submitted, setSubmitted] = useState("");
  return (
    <section>
      <h2>React Hook Form</h2>
      <form
        onSubmit={(event) => {
          void handleSubmit((values) => setSubmitted(values.message))(event);
        }}
      >
        <label htmlFor="support">Support message</label>
        <VoiceTextarea
          id="support"
          {...register("message", {
            required: "Enter a message",
            minLength: { value: 5, message: "Use at least five characters" },
          })}
          disabled={disabled}
          maxLength={120}
          voice={{ provider, audioSource: simulatedAudio }}
        />
        {errors.message ? <p role="alert">{errors.message.message}</p> : null}
        <p data-testid="dirty">{isDirty ? "Edited" : "Unchanged"}</p>
        <div className="actions">
          <button type="submit" disabled={disabled}>
            Submit
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              setSubmitted("");
            }}
          >
            Reset
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => setDisabled(event.currentTarget.checked)}
          />{" "}
          Disable field
        </label>
      </form>
      <output aria-label="Submitted message">{submitted}</output>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main>
      <h1>Try voice input</h1>
      <p>
        Simulated transcription. No microphone, account, or API key required.
      </p>
      <p>Start dictation, move the cursor, edit a phrase, and try Undo.</p>
      <Composer />
      <SupportForm />
    </main>
  </StrictMode>,
);
