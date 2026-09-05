import type { CreateOpenAITokenHandlerOptions } from "@voiceinput/openai/server";

// Type contracts for the consuming app's helpers, not an auth implementation.
// These declarations let Astro check the displayed examples against the SDK.
export declare function authenticateRequest(
  request: Request,
): Promise<{ id: string } | null>;
export declare function consumeVoiceQuota(
  subject: string,
): ReturnType<NonNullable<CreateOpenAITokenHandlerOptions["rateLimit"]>>;
