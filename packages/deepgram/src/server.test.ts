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
});

function tokenRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.test/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
