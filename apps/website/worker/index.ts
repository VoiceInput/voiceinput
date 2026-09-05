import { DurableObject } from "cloudflare:workers";
import { openai } from "@voiceinput/openai";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import { DEMO_PROTOCOL } from "../src/lib/demo-config";
import { jsonError } from "./limits";
import { DemoQuota } from "./quota";
import { relaySession } from "./relay";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/demo/"))
      return env.ASSETS.fetch(request);
    const origins = env.DEMO_ORIGINS.split(",").map((value) => value.trim());
    if (
      !origins.includes(request.headers.get("Origin") ?? "") ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    ) {
      return jsonError(403, "Open the demo on the VoiceInput website.");
    }
    if (!env.OPENAI_API_KEY)
      return jsonError(503, "The voice demo is temporarily unavailable.");
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return jsonError(403, "Unable to verify this demo request.");
    try {
      // One coordinator is intentional: this small public demo has one shared budget.
      const demo = env.DEMO_GUARD.getByName("public-demo");
      const headers = new Headers(request.headers);
      headers.set("X-Demo-Client", ip);
      return await demo.fetch(new Request(request, { headers }));
    } catch {
      return jsonError(503, "The voice demo is temporarily unavailable.");
    }
  },
} satisfies ExportedHandler<Env>;

export class DemoGuard extends DurableObject<Env> {
  private readonly quota: DemoQuota;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.quota = new DemoQuota(ctx.storage.sql);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO settings VALUES ('salt', ?)",
      crypto.randomUUID(),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    const salt = sql
      .exec<{ value: string }>("SELECT value FROM settings WHERE key = 'salt'")
      .one().value;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        salt +
          new Date(now).toISOString().slice(0, 10) +
          request.headers.get("X-Demo-Client"),
      ),
    );
    const client = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const path = new URL(request.url).pathname;
    if (path === "/api/demo/session") {
      if (request.method !== "POST")
        return jsonError(405, "Use POST to start a demo.");
      if (
        request.headers.get("Content-Type")?.split(";", 1)[0] !==
        "application/json"
      )
        return jsonError(415, "Expected JSON.");
      // The public endpoint accepts no model, credentials, or provider configuration.
      const reader = request.body?.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 32) {
              await reader.cancel();
              return jsonError(413, "Request is too large.");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      if (new TextDecoder().decode(body).trim() !== "{}")
        return jsonError(400, "No demo settings are accepted.");
      return this.quota.issue(client, Date.now());
    }
    if (path !== "/api/demo/stream")
      return jsonError(404, "Demo endpoint not found.");
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    )
      return jsonError(426, "A WebSocket connection is required.");
    const protocols =
      request.headers
        .get("Sec-WebSocket-Protocol")
        ?.split(",")
        .map((part) => part.trim()) ?? [];
    const ticket = protocols
      .find((part) => /^ticket\.[0-9a-f-]{36}$/.test(part))
      ?.slice(7);
    if (!ticket || !protocols.includes(DEMO_PROTOCOL))
      return jsonError(401, "Start a new demo session.");
    const denied = this.quota.consume(ticket, client, Date.now());
    if (denied) return denied;
    const issue = createOpenAITokenHandler({
      apiKey: this.env.OPENAI_API_KEY,
      authorize: () => ({ subject: client }),
    });
    const provider = openai({
      tokenEndpoint: "https://demo.internal/token",
      // Credential exchange stays inside the server; the browser gets only its one-use ticket.
      fetch: (_input, init) =>
        issue(new Request("https://demo.internal/token", init)),
    });
    const pair = new WebSocketPair();
    pair[1].binaryType = "arraybuffer";
    pair[1].accept();
    this.ctx.waitUntil(
      relaySession(pair[1], provider).finally(() => {
        this.quota.release(ticket);
      }),
    );
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: {
        "Sec-WebSocket-Protocol": DEMO_PROTOCOL,
        "Cache-Control": "no-store",
      },
    });
  }
}
