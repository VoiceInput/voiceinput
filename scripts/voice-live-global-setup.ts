import type { FullConfig } from "@playwright/test";

const requiredCredentials = [
  "OPENAI_API_KEY",
  "DEEPGRAM_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

export default function globalSetup(_config: FullConfig): void {
  const missing = missingVoiceLiveCredentials(process.env);
  if (missing.length > 0) {
    throw new Error(
      `[voice-live:configuration] Missing: ${missing.join(", ")}`,
    );
  }
}

export function missingVoiceLiveCredentials(
  environment: NodeJS.ProcessEnv,
): string[] {
  return requiredCredentials.filter(
    (name) => (environment[name] ?? "").trim().length === 0,
  );
}
