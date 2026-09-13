export const DEMO_SECONDS = 20;
export const DEMO_SAMPLE_RATE = 24_000;
export const DEMO_PROTOCOL = "voiceinput-demo";

// Stopping capture and waiting for transcription are separate budgets.
export const DEMO_FINALIZATION_TIMEOUT_MS = 30_000;
export const DEMO_CLIENT_FINALIZATION_TIMEOUT_MS =
  DEMO_FINALIZATION_TIMEOUT_MS + 5_000;
