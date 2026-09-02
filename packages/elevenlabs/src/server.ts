import { ELEVENLABS_DEFAULT_MODEL } from "./session-config.js";

const DEFAULT_TOKEN_URL =
  "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";
const MAX_TOKEN_REQUEST_BYTES = 16 * 1024;

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
      const requestBody = await readJsonBody(request);
      const authorization = await options.authorize(
        copyRequest(request, requestBody),
      );
      if (authorization === null) {
        return jsonError(401, "unauthorized", "Unauthorized.");
      }
      const subject = nonEmpty(authorization.subject, "subject");
      const model = readModel(requestBody, defaultModel);
      if (!allowedModels.has(model)) {
        return jsonError(
          400,
          "invalid-configuration",
          "The requested ElevenLabs model is not allowed.",
        );
      }
      const context: ElevenLabsTokenHandlerContext = {
        request: copyRequest(request, requestBody),
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
        return jsonError(error.status, error.code, error.message);
      }
      return jsonError(
        500,
        "token-error",
        "Unable to issue an ElevenLabs single-use token.",
      );
    }
  };
}

function readModel(body: string, defaultModel: string): string {
  try {
    if (body.length === 0) {
      return defaultModel;
    }
    const value = JSON.parse(body) as unknown;
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

function copyRequest(request: Request, body: string): Request {
  return new Request(request, {
    method: "POST",
    body,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
  });
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
  constructor(
    message: string,
    readonly code:
      "invalid-configuration" | "invalid-request" = "invalid-configuration",
    readonly status = 400,
  ) {
    super(message);
    this.name = "InvalidTokenRequestError";
  }
}

async function readJsonBody(request: Request): Promise<string> {
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new InvalidTokenRequestError(
      "Content-Type must be application/json.",
      "invalid-request",
      415,
    );
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (declaredLength > MAX_TOKEN_REQUEST_BYTES) throw requestTooLarge();
  const reader = request.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_TOKEN_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      throw requestTooLarge();
    }
    try {
      text += decoder.decode(value, { stream: true });
    } catch {
      await reader.cancel().catch(() => {});
      throw invalidUtf8();
    }
  }
  try {
    return text + decoder.decode();
  } catch {
    throw invalidUtf8();
  }
}

function requestTooLarge(): InvalidTokenRequestError {
  return new InvalidTokenRequestError(
    `Token request body exceeds ${MAX_TOKEN_REQUEST_BYTES} bytes.`,
    "invalid-request",
    413,
  );
}

function invalidUtf8(): InvalidTokenRequestError {
  return new InvalidTokenRequestError(
    "Token request body must be valid UTF-8.",
    "invalid-request",
  );
}

function jsonError(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-VoiceInput-Error", "1");
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
