import { describe, expect, it, vi } from "vitest";

import { createElevenLabsTokenHandler } from "./server.js";

describe("createElevenLabsTokenHandler", () => {
  it("authorizes, rate limits, mints, and audits without leaking credentials", async () => {
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("sk-server");
      expect(init?.body).toBeUndefined();
      return Response.json({ token: "sutkn_secret", ignored: "private" });
    });
    const audit = vi.fn<(value: unknown) => void>();
    const handler = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      rateLimit: ({ subject, model }) => ({
        allowed: subject === "user-1" && model === "scribe_v2_realtime",
      }),
      onTokenIssued: audit,
      fetch: upstream,
    });

    const response = await handler(tokenRequest({}));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ token: "sutkn_secret" });
    expect(audit).toHaveBeenCalledWith({
      provider: "elevenlabs",
      subject: "user-1",
      model: "scribe_v2_realtime",
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("sutkn_secret");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("sk-server");
  });

  it("rejects unauthorized, rate-limited, and disallowed requests before minting", async () => {
    const upstream = vi.fn<typeof fetch>();
    const unauthorized = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: () => null,
      fetch: upstream,
    });
    const limited = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      rateLimit: () => ({ allowed: false, retryAfterSeconds: 1.2 }),
      fetch: upstream,
    });
    const constrained = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      allowedModels: ["scribe_v2_realtime"],
      fetch: upstream,
    });

    expect((await unauthorized(tokenRequest({}))).status).toBe(401);
    const limitedResponse = await limited(tokenRequest({}));
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("Retry-After")).toBe("2");
    expect(
      (await constrained(tokenRequest({ model: "untrusted" }))).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("normalizes upstream failures and uses Fetch-standard method handling", async () => {
    const handler = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      fetch: vi.fn<typeof fetch>(async () =>
        Response.json({ detail: "sensitive" }, { status: 401 }),
      ),
    });

    const failure = await handler(tokenRequest({}));
    const method = await handler(
      new Request("https://example.test/token", { method: "GET" }),
    );
    expect(failure.status).toBe(502);
    expect(await failure.text()).not.toContain("sensitive");
    expect(method.status).toBe(405);
    expect(method.headers.get("Allow")).toBe("POST");
  });

  it("bounds JSON requests and isolates application body readers", async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({ token: "single-use" }),
    );
    const handler = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: async (request) => {
        expect(request.credentials).toBe("include");
        expect(request.cache).toBe("no-store");
        expect(await request.json()).toEqual({ model: "scribe_v2_realtime" });
        return { subject: "user-1" };
      },
      rateLimit: async ({ request }) => {
        expect(await request.json()).toEqual({ model: "scribe_v2_realtime" });
        return { allowed: true };
      },
      fetch: upstream,
    });

    expect(
      (
        await handler(
          tokenRequest(
            { model: "scribe_v2_realtime" },
            { credentials: "include", cache: "no-store" },
          ),
        )
      ).status,
    ).toBe(200);
    const invalidHandler = createElevenLabsTokenHandler({
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
    const handler = createElevenLabsTokenHandler({
      apiKey: "sk-server",
      authorize: () => ({ subject: "user-1" }),
      onTokenIssued: () => {
        throw new Error("audit unavailable");
      },
      fetch: async () => Response.json({ token: "issued-secret" }),
    });

    const response = await handler(tokenRequest({}));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("issued-secret");
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
