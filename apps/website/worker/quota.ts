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
      "CREATE TABLE IF NOT EXISTS reservations (ticket TEXT NOT NULL, key TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(ticket, key))",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS active (id TEXT PRIMARY KEY, client TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
  }

  clean(now: number) {
    // Return unused/failed reservations before removing their tickets or slots.
    const expired = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM tickets WHERE expires <= ? UNION SELECT id FROM active WHERE expires <= ?",
        now,
        now,
      )
      .toArray();
    for (const { id } of expired) this.refund(id);
    this.sql.exec("DELETE FROM usage WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM tickets WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM active WHERE expires <= ?", now);
  }

  issue(client: string, now: number): Response {
    this.clean(now);
    const attemptKey = client + ":attempt";
    const attempts = this.sql
      .exec<{ count: number; expires: number }>(
        "SELECT count, expires FROM usage WHERE key = ?",
        attemptKey,
      )
      .toArray()[0];
    if (attempts && attempts.count >= 30)
      return jsonError(
        429,
        "Please wait a moment before starting another demo.",
        Math.max(1, Math.ceil((attempts.expires - now) / 1000)),
      );
    this.sql.exec(
      "INSERT INTO usage VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
      attemptKey,
      now + 60_000,
    );
    const busy = this.busy(client, now);
    if (busy) return busy;
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
    const id = crypto.randomUUID();
    for (const limit of limits) {
      const expires = (Math.floor(now / limit.window) + 1) * limit.window;
      this.sql.exec(
        "INSERT INTO usage VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
        limit.key,
        expires,
      );
      this.sql.exec(
        "INSERT INTO reservations VALUES (?, ?, ?)",
        id,
        limit.key,
        expires,
      );
    }
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
    if (!grant) {
      const existing =
        this.sql.exec("SELECT id FROM tickets WHERE id = ?", ticket).toArray()
          .length > 0;
      console.warn(
        JSON.stringify({
          event: "demo-ticket-rejected",
          reason: existing ? "client-changed" : "expired-or-used",
        }),
      );
      return jsonError(401, "Start a new demo session.");
    }
    const busy = this.busy(client, now);
    if (busy) {
      this.refund(ticket);
      return busy;
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

  private busy(client: string, now: number): Response | undefined {
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
  }

  /** A connected provider commits the reservation; startup failures return it. */
  started(ticket: string) {
    this.sql.exec("DELETE FROM reservations WHERE ticket = ?", ticket);
  }

  private refund(ticket: string) {
    const rows = this.sql
      .exec<{ key: string; expires: number }>(
        "DELETE FROM reservations WHERE ticket = ? RETURNING key, expires",
        ticket,
      )
      .toArray();
    for (const row of rows)
      this.sql.exec(
        "UPDATE usage SET count = MAX(0, count - 1) WHERE key = ? AND expires = ?",
        row.key,
        row.expires,
      );
  }

  release(ticket: string) {
    this.refund(ticket);
    this.sql.exec("DELETE FROM active WHERE id = ?", ticket);
  }
}
