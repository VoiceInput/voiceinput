import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/react";
import { openai } from "@voiceinput/openai";
import { VoiceInputProvider, useVoiceInput } from "@voiceinput/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

const provider = openai({ tokenEndpoint: "/api/voice-token" });
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required.");

function App() {
  const [message, setMessage] = useState("");

  return (
    <main>
      <h1>VoiceInput</h1>
      <Show when="signed-out">
        <SignInButton />
        <SignUpButton />
      </Show>
      <Show when="signed-in">
        <UserButton />
        <VoiceComposer message={message} setMessage={setMessage} />
      </Show>
    </main>
  );
}

function VoiceComposer({
  message,
  setMessage,
}: {
  message: string;
  setMessage: (value: string) => void;
}) {
  const { error, getTriggerProps, status, targetRef } = useVoiceInput({
    value: message,
    onValueChange: setMessage,
  });
  return (
    <>
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
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <VoiceInputProvider provider={provider}>
        <App />
      </VoiceInputProvider>
    </ClerkProvider>
  </StrictMode>,
);
