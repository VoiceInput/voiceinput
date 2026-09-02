import { describe, expect, it, vi } from "vitest";

import { createDeepgramTokenHandler } from "./server.js";

describe("createDeepgramTokenHandler", () => {
  it("authorizes, mints a bounded JWT, and audits without leaking credentials", async () => {
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Token dg-server",
      );
      expect(typeof init?.body).toBe("string");
      expect(JSON.parse(init?.body as string)).toEqual({ ttl_seconds: 45 });
      return Response.json({
        access_token: "jwt_secret",
        expires_in: 45,
        ignored: "private",
      });
    });
    const audit = vi.fn<(value: unknown) => void>();
    const handler = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: () => ({ subject: "user-1" }),
      ttlSeconds: 45,
      onTokenIssued: audit,
      fetch: upstream,
    });

    const response = await handler(tokenRequest({}));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      access_token: "jwt_secret",
      expires_in: 45,
    });
    expect(audit).toHaveBeenCalledWith({
      provider: "deepgram",
      subject: "user-1",
      model: "nova-3",
      expiresIn: 45,
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("jwt_secret");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("dg-server");
  });

  it("rejects unauthorized, rate-limited, and disallowed requests before minting", async () => {
    const upstream = vi.fn<typeof fetch>();
    const unauthorized = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: () => null,
      fetch: upstream,
    });
    const limited = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: () => ({ subject: "user-1" }),
      rateLimit: () => ({ allowed: false, retryAfterSeconds: 1.2 }),
      fetch: upstream,
    });
    const constrained = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: () => ({ subject: "user-1" }),
      allowedModels: ["nova-3"],
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

  it("validates TTL and normalizes upstream failures", async () => {
    expect(() =>
      createDeepgramTokenHandler({
        apiKey: "dg-server",
        authorize: () => ({ subject: "user-1" }),
        ttlSeconds: 3_601,
      }),
    ).toThrowError("ttlSeconds");

    const handler = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: () => ({ subject: "user-1" }),
      fetch: vi.fn<typeof fetch>(async () =>
        Response.json({ detail: "sensitive" }, { status: 403 }),
      ),
    });
    const failure = await handler(tokenRequest({}));
    expect(failure.status).toBe(502);
    expect(await failure.text()).not.toContain("sensitive");
  });

  it("bounds JSON requests, isolates body readers, and defaults to a short TTL", async () => {
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      expect(typeof init?.body).toBe("string");
      expect(JSON.parse(init?.body as string)).toEqual({ ttl_seconds: 30 });
      return Response.json({ access_token: "temporary", expires_in: 30 });
    });
    const handler = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: async (request) => {
        expect(request.credentials).toBe("include");
        expect(request.cache).toBe("no-store");
        expect(await request.json()).toEqual({ model: "nova-3" });
        return { subject: "user-1" };
      },
      rateLimit: async ({ request }) => {
        expect(await request.json()).toEqual({ model: "nova-3" });
        return { allowed: true };
      },
      fetch: upstream,
    });

    expect(
      (
        await handler(
          tokenRequest(
            { model: "nova-3" },
            { credentials: "include", cache: "no-store" },
          ),
        )
      ).status,
    ).toBe(200);
    const invalidHandler = createDeepgramTokenHandler({
      apiKey: "dg-server",
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
    const handler = createDeepgramTokenHandler({
      apiKey: "dg-server",
      authorize: () => ({ subject: "user-1" }),
      onTokenIssued: () => {
        throw new Error("audit unavailable");
      },
      fetch: async () =>
        Response.json({ access_token: "issued-secret", expires_in: 30 }),
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
