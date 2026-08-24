import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authorizeDevRequest,
  createDevAuthResponse,
  getDevAuthSecret,
  readDevAuthMode,
} from "./index.js";

const secret = "local-development-secret";

afterEach(() => vi.unstubAllEnvs());

describe("playground dev auth", () => {
  it("issues and verifies a signed HttpOnly loopback cookie", async () => {
    const login = await createDevAuthResponse(request(), {
      mode: "login",
      secret,
      now: () => 1_000,
    });
    const cookie = login.headers.get("Set-Cookie");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(
      await authorizeDevRequest(request(cookie), {
        secret,
        now: () => 2_000,
      }),
    ).toEqual({ subject: "local-maintainer" });
  });

  it("rejects expired, tampered, and remote sessions", async () => {
    const expired = await createDevAuthResponse(request(), {
      mode: "expired",
      secret,
      now: () => 2_000,
    });
    expect(
      await authorizeDevRequest(request(expired.headers.get("Set-Cookie")), {
        secret,
        now: () => 2_000,
      }),
    ).toBeNull();

    const login = await createDevAuthResponse(request(), {
      mode: "login",
      secret,
    });
    const cookie = login.headers
      .get("Set-Cookie")
      ?.replace(
        "voiceinput_dev_session_3000=",
        "voiceinput_dev_session_3000=x",
      );
    expect(await authorizeDevRequest(request(cookie), { secret })).toBeNull();

    await expect(
      createDevAuthResponse(new Request("https://example.com/auth"), {
        mode: "login",
        secret,
      }),
    ).rejects.toThrow(/loopback/u);

    await expect(
      createDevAuthResponse(request(undefined, "example.com"), {
        mode: "login",
        secret,
      }),
    ).rejects.toThrow(/loopback/u);
  });

  it("parses only supported control modes", () => {
    expect(readDevAuthMode({ mode: "login" })).toBe("login");
    expect(readDevAuthMode({ mode: "anything" })).toBeNull();
    expect(readDevAuthMode(null)).toBeNull();
  });

  it("namespaces cookies by local server port", async () => {
    const nextCookie = (
      await createDevAuthResponse(request(), {
        mode: "login",
        secret,
      })
    ).headers.get("Set-Cookie");
    const honoCookie = (
      await createDevAuthResponse(
        request(undefined, "localhost:8787", "http://localhost:8787"),
        {
          mode: "login",
          secret,
        },
      )
    ).headers.get("Set-Cookie");

    expect(nextCookie).toContain("voiceinput_dev_session_3000=");
    expect(honoCookie).toContain("voiceinput_dev_session_8787=");
    expect(
      await authorizeDevRequest(
        request(nextCookie, "localhost:8787", "http://localhost:8787"),
        {
          secret,
        },
      ),
    ).toBeNull();
  });

  it("provides a stable process-local secret for missing or empty values", () => {
    vi.stubEnv("VOICEINPUT_DEV_AUTH_SECRET", "");
    expect(getDevAuthSecret().length).toBeGreaterThanOrEqual(16);
    expect(getDevAuthSecret()).toBe(getDevAuthSecret());

    vi.stubEnv("VOICEINPUT_DEV_AUTH_SECRET", `  ${secret}  `);
    expect(getDevAuthSecret()).toBe(secret);
  });
});

function request(
  cookie?: string | null,
  host = "localhost:3000",
  origin = "http://localhost:3000",
): Request {
  return new Request(`${origin}/api/dev-auth`, {
    headers: {
      Host: host,
      ...(cookie === undefined || cookie === null ? {} : { Cookie: cookie }),
    },
  });
}
