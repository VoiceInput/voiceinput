import { VoiceInputError } from "@voiceinput/provider";
import { describe, expect, it, vi } from "vitest";

import { createOpenAITokenHandler } from "./server.js";

describe("createOpenAITokenHandler", () => {
  it("authorizes, rate limits, mints a scoped credential, and audits metadata", async () => {
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer sk-server");
      expect(headers.get("OpenAI-Safety-Identifier")).toBe("hashed-user");
      expect(typeof init?.body).toBe("string");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24_000 },
              transcription: {
                model: "gpt-live-transcribe",
                languages: ["en"],
                keywords: ["VoiceInput", "WebSocket"],
              },
              turn_detection: null,
            },
          },
        },
      });
      return Response.json({
        value: "ek_ephemeral",
        expires_at: 2_000_000_000,
        ignored_session_data: { api_key: "must-not-leak" },
      });
    });
    const audit = vi.fn<(event: unknown) => void>();
    const handler = createOpenAITokenHandler({
      apiKey: "sk-server",
      model: "gpt-live-transcribe",
      authorize: () => ({ subject: "user-1" }),
      rateLimit: ({ subject, model }) => ({
        allowed: subject === "user-1" && model === "gpt-live-transcribe",
      }),
      safetyIdentifier: () => "hashed-user",
      onTokenIssued: audit,
      fetch: upstream,
    });

    const response = await handler(
      tokenRequest({
        language: "en-CA",
        vocabulary: ["VoiceInput", "WebSocket"],
        endpointing: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      value: "ek_ephemeral",
      expires_at: 2_000_000_000,
    });
    expect(audit).toHaveBeenCalledWith({
      provider: "openai",
      subject: "user-1",
      model: "gpt-live-transcribe",
      expiresAt: 2_000_000_000,
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("ek_ephemeral");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("sk-server");
  });

  it("rejects unauthorized and rate-limited requests before minting", async () => {
    const upstream = vi.fn<typeof fetch>();
    const unauthorized = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => null,
      fetch: upstream,
    });
    const limited = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      rateLimit: () => ({ allowed: false, retryAfterSeconds: 1.2 }),
      fetch: upstream,
    });

    const unauthorizedResponse = await unauthorized(tokenRequest({}));
    const limitedResponse = await limited(tokenRequest({}));

    expect(unauthorizedResponse.status).toBe(401);
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("Retry-After")).toBe("2");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("allows only configured models and normalizes upstream failures", async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { message: "sensitive upstream detail" } },
        { status: 401 },
      ),
    );
    const handler = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      model: "gpt-transcribe",
      allowedModels: ["gpt-transcribe", "gpt-live-transcribe"],
      fetch: upstream,
    });

    const disallowed = await handler(
      tokenRequest({ model: "untrusted-model" }),
    );
    const upstreamFailure = await handler(tokenRequest({}));

    expect(disallowed.status).toBe(400);
    expect(upstreamFailure.status).toBe(502);
    expect(await upstreamFailure.text()).not.toContain("sensitive");
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("uses Fetch-standard method handling", async () => {
    const handler = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      fetch: vi.fn<typeof fetch>(),
    });

    const response = await handler(
      new Request("https://example.test/token", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("preserves unsupported token-request errors", async () => {
    const upstream = vi.fn<typeof fetch>();
    const handler = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      fetch: upstream,
    });

    const response = await handler(tokenRequest({ language: "haw" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "unsupported-feature" },
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("bounds JSON requests and isolates application body readers", async () => {
    const authorize = async (request: Request) => {
      expect(request.credentials).toBe("include");
      expect(request.cache).toBe("no-store");
      expect(request.redirect).toBe("manual");
      expect(request.referrerPolicy).toBe("no-referrer");
      expect(request.integrity).toBe("sha256-example");
      expect(request.keepalive).toBe(true);
      expect(await request.json()).toEqual({ model: "gpt-transcribe" });
      return { subject: "user-1" };
    };
    const rateLimit = async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ model: "gpt-transcribe" });
      return { allowed: true as const };
    };
    const safetyIdentifier = async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ model: "gpt-transcribe" });
      return "hashed-user";
    };
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({ value: "ephemeral", expires_at: 2_000_000_000 }),
    );
    const handler = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize,
      rateLimit,
      safetyIdentifier,
      model: "gpt-transcribe",
      fetch: upstream,
    });

    expect(
      (
        await handler(
          tokenRequest(
            { model: "gpt-transcribe" },
            {
              credentials: "include",
              cache: "no-store",
              redirect: "manual",
              referrerPolicy: "no-referrer",
              integrity: "sha256-example",
              keepalive: true,
            },
          ),
        )
      ).status,
    ).toBe(200);
    const invalidHandler = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      fetch: upstream,
    });
    const wrongType = await invalidHandler(
      new Request("https://example.test/token", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );
    const oversized = await invalidHandler(
      tokenRequest({ value: "x".repeat(16_384) }),
    );
    const invalidUtf8 = await invalidHandler(
      new Request("https://example.test/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new Uint8Array([0xff]),
      }),
    );

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get("X-VoiceInput-Error")).toBe("1");
    expect(invalidUtf8.status).toBe(400);
    expect(await invalidUtf8.json()).toMatchObject({
      error: { code: "invalid-request" },
    });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("fails closed when token audit persistence fails", async () => {
    const handler = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      onTokenIssued: () => {
        throw new Error("audit unavailable");
      },
      fetch: async () =>
        Response.json({ value: "ephemeral", expires_at: 2_000_000_000 }),
    });

    const response = await handler(tokenRequest({}));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("ephemeral");
  });

  it("does not classify server and upstream failures as client errors", async () => {
    const authorizationFailure = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => {
        throw new TypeError("internal authorization failure");
      },
      fetch: vi.fn<typeof fetch>(),
    });
    const typedAuthorizationFailure = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => {
        throw new VoiceInputError({
          code: "unsupported-feature",
          message: "private authorization detail",
        });
      },
      fetch: vi.fn<typeof fetch>(),
    });
    const invalidUpstreamJson = createOpenAITokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    });

    expect((await authorizationFailure(tokenRequest({}))).status).toBe(500);
    const typedFailure = await typedAuthorizationFailure(tokenRequest({}));
    expect(typedFailure.status).toBe(500);
    expect(await typedFailure.text()).not.toContain("private authorization");
    expect((await invalidUpstreamJson(tokenRequest({}))).status).toBe(500);
  });
});

function tokenRequest(
  body: Record<string, unknown>,
  init: Omit<RequestInit, "body" | "headers" | "method"> = {},
): Request {
  return new Request("https://example.test/token", {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
