import { DEMO_SAMPLE_RATE, DEMO_SECONDS } from "../src/lib/demo-config";

export const MAX_AUDIO_BYTES = DEMO_SAMPLE_RATE * 2 * DEMO_SECONDS;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_MESSAGES = 2_500;
export const CONNECT_TIMEOUT_MS = 10_000;
export const FINALIZE_TIMEOUT_MS = 10_000;
export const TICKET_TTL_MS = 60_000;
export const MAX_CONCURRENT = 4;
export const DAILY_SESSIONS = 100;
export const HOURLY_SESSIONS_PER_IP = 3;
export const DAILY_SESSIONS_PER_IP = 6;

export function jsonError(
  status: number,
  message: string,
  retryAfter?: number,
) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(retryAfter === undefined
          ? {}
          : { "Retry-After": String(retryAfter) }),
      },
    },
  );
}
