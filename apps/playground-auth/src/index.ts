const COOKIE_PREFIX = "voiceinput_dev_session";
const DEFAULT_TTL_SECONDS = 60 * 60;
const PROCESS_SECRET = crypto.randomUUID().repeat(2);

export interface DevAuthorization {
  readonly subject: string;
}

export interface DevAuthOptions {
  readonly secret: string;
  readonly now?: () => number;
}

export type DevAuthMode = "login" | "logout" | "expired";

export function getDevAuthSecret(): string {
  const configured = process.env["VOICEINPUT_DEV_AUTH_SECRET"]?.trim();
  return configured === undefined || configured.length === 0
    ? PROCESS_SECRET
    : configured;
}

interface SessionPayload {
  readonly subject: string;
  readonly expiresAt: number;
}

export async function authorizeDevRequest(
  request: Request,
  options: DevAuthOptions,
): Promise<DevAuthorization | null> {
  assertDevOnlyLoopback(request);
  const secret = validateSecret(options.secret);
  const token = readCookie(
    request.headers.get("Cookie"),
    getCookieName(request),
  );
  if (token === undefined) {
    return null;
  }
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const encodedPayload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!(await verify(encodedPayload, signature, secret))) {
    return null;
  }
  const payload = decodePayload(encodedPayload);
  const now = options.now?.() ?? Date.now();
  return payload !== null && payload.expiresAt > now
    ? { subject: payload.subject }
    : null;
}

export async function createDevAuthResponse(
  request: Request,
  options: DevAuthOptions & { readonly mode: DevAuthMode },
): Promise<Response> {
  assertDevOnlyLoopback(request);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  if (options.mode === "logout") {
    headers.append(
      "Set-Cookie",
      serializeCookie(getCookieName(request), "", {
        maxAge: 0,
        secure: isSecure(request),
      }),
    );
    return new Response(JSON.stringify({ authenticated: false }), { headers });
  }

  const now = options.now?.() ?? Date.now();
  const expiresAt =
    options.mode === "expired"
      ? now - 1_000
      : now + DEFAULT_TTL_SECONDS * 1_000;
  const encodedPayload = encodePayload({
    subject: "local-maintainer",
    expiresAt,
  });
  const signature = await sign(encodedPayload, validateSecret(options.secret));
  headers.append(
    "Set-Cookie",
    serializeCookie(getCookieName(request), `${encodedPayload}.${signature}`, {
      maxAge: DEFAULT_TTL_SECONDS,
      secure: isSecure(request),
    }),
  );
  return new Response(
    JSON.stringify({
      authenticated: options.mode === "login",
      mode: options.mode,
    }),
    { headers },
  );
}

export function readDevAuthMode(value: unknown): DevAuthMode | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    (value.mode === "login" ||
      value.mode === "logout" ||
      value.mode === "expired")
  ) {
    return value.mode;
  }
  return null;
}

function assertDevOnlyLoopback(request: Request): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("The playground auth fixture is disabled in production.");
  }
  const urlHostname = new URL(request.url).hostname;
  const hostHeader = request.headers.get("Host");
  if (!isLoopbackHostname(urlHostname) || !isLoopbackHost(hostHeader)) {
    throw new Error(
      "The playground auth fixture accepts loopback requests only.",
    );
  }
}

function isLoopbackHost(value: string | null): boolean {
  if (value === null || value.length === 0 || value.trim() !== value) {
    return false;
  }
  try {
    const parsed = new URL(`http://${value}/`);
    return (
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      isLoopbackHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function validateSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error(
      "VOICEINPUT_DEV_AUTH_SECRET must contain at least 16 characters.",
    );
  }
  return secret;
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function getCookieName(request: Request): string {
  const url = new URL(request.url);
  const port =
    url.port ||
    (url.protocol === "https:"
      ? "443"
      : url.protocol === "http:"
        ? "80"
        : "other");
  return `${COOKIE_PREFIX}_${port}`;
}

function serializeCookie(
  name: string,
  value: string,
  options: { readonly maxAge: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBytes(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

async function verify(
  value: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBytes(signature);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(value),
  );
}

function encodePayload(payload: SessionPayload): string {
  return encodeBytes(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(value: string): SessionPayload | null {
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBytes(value)),
    ) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("subject" in payload) ||
      typeof payload.subject !== "string" ||
      !("expiresAt" in payload) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isFinite(payload.expiresAt)
    ) {
      return null;
    }
    return { subject: payload.subject, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

function encodeBytes(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBytes(value: string): Uint8Array {
  return Buffer.from(value, "base64url");
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
