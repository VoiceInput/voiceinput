"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useVoiceInput } from "@voiceinput/react";
import { useState } from "react";

export default function Page() {
  const [message, setMessage] = useState("");
  const { error, getTriggerProps, status, targetRef } = useVoiceInput({
    value: message,
    onValueChange: setMessage,
  });

  return (
    <main>
      <h1>VoiceInput</h1>
      <Show when="signed-out">
        <SignInButton />
        <SignUpButton />
      </Show>
      <Show when="signed-in">
        <UserButton />
        <textarea
          aria-label="Message"
          ref={targetRef}
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
        />
        <button {...getTriggerProps()}>
          {status === "listening" ? "Stop" : "Speak"}
        </button>
        <output aria-live="polite">{status}</output>
        {error ? <p role="alert">{error.message}</p> : null}
      </Show>
    </main>
  );
}
