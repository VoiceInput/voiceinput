import { VoiceInputError } from "@voiceinput/provider";

import {
  OPENAI_DEFAULT_MODEL,
  createOpenAITranscriptionSession,
  validateOpenAITokenRequest,
} from "./session-config.js";

const DEFAULT_CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
const MAX_TOKEN_REQUEST_BYTES = 16 * 1024;

export interface OpenAIAuthorization {
  readonly subject: string;
}

export type OpenAIRateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds?: number };

export interface OpenAITokenHandlerContext {
  readonly request: Request;
  readonly subject: string;
  readonly model: string;
}

export interface OpenAITokenIssuedMetadata {
  readonly provider: "openai";
  readonly subject: string;
  readonly model: string;
  readonly expiresAt: number;
}

export interface CreateOpenAITokenHandlerOptions {
  readonly apiKey: string;
  readonly authorize: (
    request: Request,
  ) => PromiseLike<OpenAIAuthorization | null> | OpenAIAuthorization | null;
  readonly model?: string;
  readonly allowedModels?: readonly string[];
  readonly organization?: string;
  readonly project?: string;
  readonly safetyIdentifier?: (
    context: OpenAITokenHandlerContext,
  ) => PromiseLike<string | undefined> | string | undefined;
  readonly rateLimit?: (
    context: OpenAITokenHandlerContext,
  ) => PromiseLike<OpenAIRateLimitResult> | OpenAIRateLimitResult;
  readonly onTokenIssued?: (
    metadata: OpenAITokenIssuedMetadata,
  ) => PromiseLike<void> | void;
  readonly fetch?: typeof globalThis.fetch;
  readonly clientSecretUrl?: string;
}

export function createOpenAITokenHandler(
  options: CreateOpenAITokenHandlerOptions,
): (request: Request) => Promise<Response> {
  const defaultModel = validateNonEmpty(
    options.model ?? OPENAI_DEFAULT_MODEL,
    "model",
  );
  const allowedModels = new Set(options.allowedModels ?? [defaultModel]);
  if (!allowedModels.has(defaultModel)) {
    throw new TypeError("allowedModels must contain the default model.");
  }
  if (typeof options.authorize !== "function") {
    throw new TypeError("authorize must be a function.");
  }
  const apiKey = validateNonEmpty(options.apiKey, "apiKey");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const clientSecretUrl = options.clientSecretUrl ?? DEFAULT_CLIENT_SECRET_URL;

  return async (request) => {
    if (request.method !== "POST") {
      return jsonError(405, "invalid-request", "Method not allowed.", {
        Allow: "POST",
      });
    }

    try {
      const requestBody = await readRequestBody(request);
      const authorization = await options.authorize(
        copyRequest(request, requestBody),
      );
      if (authorization === null) {
        return jsonError(401, "unauthorized", "Unauthorized.");
      }
      const subject = validateNonEmpty(authorization.subject, "subject");
      const tokenRequest = readTokenRequest(requestBody, defaultModel);
      if (!allowedModels.has(tokenRequest.model)) {
        return jsonError(
          400,
          "invalid-configuration",
          "The requested OpenAI model is not allowed.",
        );
      }
      const createContext = (): OpenAITokenHandlerContext => ({
        request: copyRequest(request, requestBody),
        subject,
        model: tokenRequest.model,
      });
      const rateLimit = await options.rateLimit?.(createContext());
      if (rateLimit?.allowed === false) {
        const retryAfter = normalizeRetryAfter(rateLimit.retryAfterSeconds);
        return jsonError(
          429,
          "rate-limited",
          "Rate limit exceeded.",
          retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
        );
      }

      const safetyIdentifier =
        await options.safetyIdentifier?.(createContext());
      const response = await fetchImplementation(clientSecretUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(options.organization === undefined
            ? {}
            : { "OpenAI-Organization": options.organization }),
          ...(options.project === undefined
            ? {}
            : { "OpenAI-Project": options.project }),
          ...(safetyIdentifier === undefined
            ? {}
            : {
                "OpenAI-Safety-Identifier": validateNonEmpty(
                  safetyIdentifier,
                  "safetyIdentifier",
                ),
              }),
        },
        body: JSON.stringify({
          session: createOpenAITranscriptionSession(tokenRequest),
        }),
        signal: request.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          return jsonError(
            429,
            "rate-limited",
            "OpenAI rate limit exceeded.",
            copyRetryAfter(response.headers),
          );
        }
        return jsonError(
          502,
          "token-error",
          "OpenAI did not issue a client credential.",
        );
      }

      const credential = validateCredential(await response.json());
      await options.onTokenIssued?.({
        provider: "openai",
        subject,
        model: tokenRequest.model,
        expiresAt: credential.expires_at,
      });

      return Response.json(credential, {
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
        "Unable to issue an OpenAI client credential.",
      );
    }
  };
}

async function readRequestBody(request: Request): Promise<string> {
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
  if (declaredLength > MAX_TOKEN_REQUEST_BYTES) {
    throw requestTooLarge();
  }
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
    text += decoder.decode();
  } catch {
    throw invalidUtf8();
  }
  return text;
}

function readTokenRequest(
  body: string,
  defaultModel: string,
): ReturnType<typeof validateOpenAITokenRequest> {
  try {
    return validateOpenAITokenRequest(
      body.length === 0 ? {} : JSON.parse(body),
      defaultModel,
    );
  } catch (cause) {
    if (cause instanceof SyntaxError || cause instanceof TypeError) {
      throw new InvalidTokenRequestError(cause.message);
    }
    if (
      VoiceInputError.isInstance(cause) &&
      (cause.code === "invalid-configuration" ||
        cause.code === "unsupported-feature")
    ) {
      throw new InvalidTokenRequestError(cause.message, cause.code);
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

class InvalidTokenRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid-configuration"
      | "invalid-request"
      | "unsupported-feature" = "invalid-configuration",
    readonly status = 400,
  ) {
    super(message);
    this.name = "InvalidTokenRequestError";
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

function validateCredential(value: unknown): {
  value: string;
  expires_at: number;
} {
  if (
    !isRecord(value) ||
    typeof value["value"] !== "string" ||
    value["value"].length === 0 ||
    typeof value["expires_at"] !== "number" ||
    !Number.isFinite(value["expires_at"])
  ) {
    throw new Error("OpenAI returned an invalid client credential.");
  }
  return {
    value: value["value"],
    expires_at: value["expires_at"],
  };
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
    {
      status,
      headers: responseHeaders,
    },
  );
}

function copyRetryAfter(headers: Headers): HeadersInit {
  const retryAfter = headers.get("Retry-After");
  return retryAfter === null ? {} : { "Retry-After": retryAfter };
}

function normalizeRetryAfter(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? undefined
    : Math.ceil(value);
}

function validateNonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
