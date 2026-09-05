"use client";

import { useState } from "react";
import { VoiceTextarea } from "@voiceinput/react";
import { openai } from "@voiceinput/openai";
import "@voiceinput/react/styles.css";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Composer() {
  const [text, setText] = useState("");

  return (
    <VoiceTextarea
      aria-label="Message"
      placeholder="Write a message…"
      value={text}
      onValueChange={setText}
      voice={{ provider }}
    />
  );
}
