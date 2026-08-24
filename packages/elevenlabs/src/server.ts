import { ELEVENLABS_DEFAULT_MODEL } from "./session-config.js";

const DEFAULT_TOKEN_URL =
  "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";

export interface ElevenLabsAuthorization {
  readonly subject: string;
}

export type ElevenLabsRateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds?: number };

export interface ElevenLabsTokenHandlerContext {
  readonly request: Request;
  readonly subject: string;
  readonly model: string;
}

export interface ElevenLabsTokenIssuedMetadata {
  readonly provider: "elevenlabs";
  readonly subject: string;
  readonly model: string;
}

export interface CreateElevenLabsTokenHandlerOptions {
  readonly apiKey: string;
  readonly authorize: (
    request: Request,
  ) =>
    | PromiseLike<ElevenLabsAuthorization | null>
    | ElevenLabsAuthorization
    | null;
  readonly model?: string;
  readonly allowedModels?: readonly string[];
  readonly rateLimit?: (
    context: ElevenLabsTokenHandlerContext,
  ) => PromiseLike<ElevenLabsRateLimitResult> | ElevenLabsRateLimitResult;
  readonly onTokenIssued?: (
    metadata: ElevenLabsTokenIssuedMetadata,
  ) => PromiseLike<void> | void;
  readonly fetch?: typeof globalThis.fetch;
  readonly tokenUrl?: string;
}

export function createElevenLabsTokenHandler(
  options: CreateElevenLabsTokenHandlerOptions,
): (request: Request) => Promise<Response> {
  const defaultModel = nonEmpty(
    options.model ?? ELEVENLABS_DEFAULT_MODEL,
    "model",
  );
  const allowedModels = new Set(options.allowedModels ?? [defaultModel]);
  if (!allowedModels.has(defaultModel)) {
    throw new TypeError("allowedModels must contain the default model.");
  }
  if (typeof options.authorize !== "function") {
    throw new TypeError("authorize must be a function.");
  }
  const apiKey = nonEmpty(options.apiKey, "apiKey");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;

  return async (request) => {
    if (request.method !== "POST") {
      return jsonError(405, "invalid-request", "Method not allowed.", {
        Allow: "POST",
      });
    }
    try {
      const authorization = await options.authorize(request);
      if (authorization === null) {
        return jsonError(401, "unauthorized", "Unauthorized.");
      }
      const subject = nonEmpty(authorization.subject, "subject");
      const model = await readModel(request, defaultModel);
      if (!allowedModels.has(model)) {
        return jsonError(
          400,
          "invalid-configuration",
          "The requested ElevenLabs model is not allowed.",
        );
      }
      const context: ElevenLabsTokenHandlerContext = {
        request,
        subject,
        model,
      };
      const limit = await options.rateLimit?.(context);
      if (limit?.allowed === false) {
        const retryAfter = normalizeRetryAfter(limit.retryAfterSeconds);
        return jsonError(
          429,
          "rate-limited",
          "Rate limit exceeded.",
          retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
        );
      }
      const response = await fetchImplementation(tokenUrl, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        signal: request.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          return jsonError(
            429,
            "rate-limited",
            "ElevenLabs rate limit exceeded.",
            copyRetryAfter(response.headers),
          );
        }
        return jsonError(
          502,
          "token-error",
          "ElevenLabs did not issue a single-use token.",
        );
      }
      const token = validateToken(await response.json());
      await options.onTokenIssued?.({
        provider: "elevenlabs",
        subject,
        model,
      });
      return Response.json(token, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (request.signal.aborted) {
        return jsonError(499, "network-error", "The request was cancelled.");
      }
      if (error instanceof InvalidTokenRequestError) {
        return jsonError(400, "invalid-configuration", error.message);
      }
      return jsonError(
        500,
        "token-error",
        "Unable to issue an ElevenLabs single-use token.",
      );
    }
  };
}

async function readModel(
  request: Request,
  defaultModel: string,
): Promise<string> {
  try {
    const text = await request.text();
    if (text.length === 0) {
      return defaultModel;
    }
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "model")) {
      throw new TypeError("The token request must contain only model.");
    }
    return value["model"] === undefined
      ? defaultModel
      : nonEmpty(value["model"], "model");
  } catch (cause) {
    if (cause instanceof SyntaxError || cause instanceof TypeError) {
      throw new InvalidTokenRequestError(cause.message);
    }
    throw cause;
  }
}

function validateToken(value: unknown): { token: string } {
  if (
    !isRecord(value) ||
    typeof value["token"] !== "string" ||
    value["token"].length === 0
  ) {
    throw new Error("ElevenLabs returned an invalid token.");
  }
  return { token: value["token"] };
}

class InvalidTokenRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenRequestError";
  }
}

function jsonError(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(
    { error: { code, message } },
    { status, headers: responseHeaders },
  );
}

function copyRetryAfter(headers: Headers): HeadersInit {
  const value = headers.get("Retry-After");
  return value === null ? {} : { "Retry-After": value };
}

function normalizeRetryAfter(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? undefined
    : Math.ceil(value);
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
