"use client";

import { useVoiceInput } from "@voiceinput/react";
import { openai } from "@voiceinput/openai";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Composer() {
  const { targetRef, getTriggerProps, status, error } = useVoiceInput({
    provider,
  });
  const active = status !== "idle" && status !== "error";

  return (
    <>
      <textarea aria-label="Message" name="message" ref={targetRef} />
      <button {...getTriggerProps()}>{active ? "Stop" : "Speak"}</button>
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
