"use client";

import { openai } from "@voiceinput/openai";
import { VoiceInputProvider } from "@voiceinput/react";

const provider = openai({ tokenEndpoint: "/api/voice-token" });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <VoiceInputProvider provider={provider}>{children}</VoiceInputProvider>
  );
}
