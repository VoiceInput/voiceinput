import { DEMO_SECONDS } from "../src/lib/demo-config";
import {
  CONNECT_TIMEOUT_MS,
  DAILY_SESSIONS,
  DAILY_SESSIONS_PER_IP,
  FINALIZE_TIMEOUT_MS,
  HOURLY_SESSIONS_PER_IP,
  MAX_CONCURRENT,
  TICKET_TTL_MS,
  jsonError,
} from "./limits";

/** Synchronous SQLite operations make each reservation atomic before any provider I/O. */
export class DemoQuota {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS usage (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, client TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS active (id TEXT PRIMARY KEY, client TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
  }

  clean(now: number) {
    this.sql.exec("DELETE FROM usage WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM tickets WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM active WHERE expires <= ?", now);
  }

  issue(client: string, now: number): Response {
    this.clean(now);
    const limits = [
      { key: "global", limit: DAILY_SESSIONS, window: 86_400_000 },
      {
        key: client + ":hour",
        limit: HOURLY_SESSIONS_PER_IP,
        window: 3_600_000,
      },
      {
        key: client + ":day",
        limit: DAILY_SESSIONS_PER_IP,
        window: 86_400_000,
      },
    ];
    for (const limit of limits) {
      const row = this.sql
        .exec<{ count: number; expires: number }>(
          "SELECT count, expires FROM usage WHERE key = ?",
          limit.key,
        )
        .toArray()[0];
      if (row && row.count >= limit.limit)
        return jsonError(
          429,
          limit.key === "global"
            ? "Today's demo limit has been reached. Please try again tomorrow."
            : "You've reached the demo limit. Please try again later.",
          Math.max(1, Math.ceil((row.expires - now) / 1_000)),
        );
    }
    for (const limit of limits) {
      const expires = (Math.floor(now / limit.window) + 1) * limit.window;
      this.sql.exec(
        "INSERT INTO usage VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
        limit.key,
        expires,
      );
    }
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO tickets VALUES (?, ?, ?)",
      id,
      client,
      now + TICKET_TTL_MS,
    );
    return Response.json(
      { ticket: id },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  consume(ticket: string, client: string, now: number): Response | undefined {
    this.clean(now);
    const grant = this.sql
      .exec<{ id: string }>(
        "DELETE FROM tickets WHERE id = ? AND client = ? AND expires > ? RETURNING id",
        ticket,
        client,
        now,
      )
      .toArray()[0];
    if (!grant) return jsonError(401, "Start a new demo session.");
    if (
      this.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM active WHERE expires > ?",
          now,
        )
        .one().count >= MAX_CONCURRENT ||
      this.sql
        .exec(
          "SELECT id FROM active WHERE client = ? AND expires > ?",
          client,
          now,
        )
        .toArray().length > 0
    ) {
      return jsonError(
        429,
        "The demo is busy. Please try again in a minute.",
        60,
      );
    }
    this.sql.exec(
      "INSERT INTO active VALUES (?, ?, ?)",
      ticket,
      client,
      now +
        CONNECT_TIMEOUT_MS +
        DEMO_SECONDS * 1_000 +
        FINALIZE_TIMEOUT_MS +
        5_000,
    );
  }

  release(ticket: string) {
    this.sql.exec("DELETE FROM active WHERE id = ?", ticket);
  }
}
