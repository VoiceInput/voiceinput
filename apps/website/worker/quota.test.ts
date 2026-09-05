import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { DemoQuota } from "./quota";
import {
  DAILY_SESSIONS,
  DAILY_SESSIONS_PER_IP,
  HOURLY_SESSIONS_PER_IP,
} from "./limits";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
function setup() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const sql = {
    exec(query: string, ...bindings: (string | number)[]) {
      const statement = database.prepare(query);
      const rows = statement.columns().length
        ? statement.all(...bindings)
        : (statement.run(...bindings), []);
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error("Expected one row");
          return rows[0];
        },
      };
    },
  } as SqlStorage;
  return { sql, quota: new DemoQuota(sql) };
}
const now = Date.UTC(2026, 8, 5, 12);
async function ticket(quota: DemoQuota, client = "client", time = now) {
  const response = quota.issue(client, time);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return ((await response.json()) as { ticket: string }).ticket;
}

test("tickets survive network changes, expire, and can only be consumed once", async () => {
  const { quota } = setup();
  const first = await ticket(quota);
  expect(quota.consume(first, "different-client", now)).toBeUndefined();
  expect(quota.consume(first, "client", now)?.status).toBe(401);
  const second = await ticket(quota, "other");
  expect(quota.consume(second, "other", now + 60_000)?.status).toBe(401);
});

test("concurrent reservations cannot bypass hourly limits", async () => {
  const { quota } = setup();
  const responses = Array.from({ length: HOURLY_SESSIONS_PER_IP + 1 }, () =>
    quota.issue("client", now),
  );
  expect(responses.filter((r) => r.status === 200)).toHaveLength(
    HOURLY_SESSIONS_PER_IP,
  );
  expect(responses.at(-1)?.status).toBe(429);
  expect(responses.at(-1)?.headers.get("Retry-After")).toBe("60");
});

async function record(quota: DemoQuota, client: string, time: number) {
  const id = await ticket(quota, client, time);
  expect(quota.consume(id, client, time)).toBeUndefined();
  quota.started(id);
  quota.release(id);
}

test("successful recordings retain hourly and daily quotas", async () => {
  const { quota } = setup();
  for (let i = 0; i < DAILY_SESSIONS_PER_IP; i++) {
    const hour = Math.floor(i / HOURLY_SESSIONS_PER_IP);
    await record(quota, "client", now + hour * 3_600_000);
  }
  expect(quota.issue("client", now + 14_400_000).status).toBe(429);
});

test("daily global budget persists across object reconstruction", async () => {
  const { quota, sql } = setup();
  for (let i = 0; i < DAILY_SESSIONS; i++)
    await record(quota, `client-${i}`, now);
  const restarted = new DemoQuota(sql);
  expect(restarted.issue("new-client", now).status).toBe(429);
  expect(restarted.issue("new-client", now + 86_400_000).status).toBe(200);
});

test("busy requests fail before ticket issuance and racing tickets are refunded", async () => {
  const { quota, sql } = setup();
  const first = await ticket(quota);
  const duplicate = await ticket(quota);
  const overflow = await ticket(quota, "overflow");
  expect(quota.consume(first, "client", now)).toBeUndefined();
  expect(quota.issue("client", now).status).toBe(429);
  expect(quota.consume(duplicate, "client", now)?.status).toBe(429);
  for (let i = 0; i < 3; i++) {
    const grant = await ticket(quota, `other-${i}`);
    expect(quota.consume(grant, `other-${i}`, now)).toBeUndefined();
  }
  expect(quota.issue("another", now).status).toBe(429);
  expect(quota.consume(overflow, "overflow", now)?.status).toBe(429);
  expect(
    sql
      .exec<{ count: number }>(
        "SELECT count FROM usage WHERE key = 'overflow:hour'",
      )
      .one().count,
  ).toBe(0);
  quota.release(first);
  const next = await ticket(quota, "new");
  expect(quota.consume(next, "new", now)).toBeUndefined();
  expect(quota.consume(overflow, "overflow", now)?.status).toBe(401);
});

test("failed startups return quota, but repeated failures still have a short abuse limit", async () => {
  const { quota } = setup();
  for (let i = 0; i < 30; i++) {
    const id = await ticket(quota);
    expect(quota.consume(id, "client", now)).toBeUndefined();
    quota.release(id);
    quota.release(id); // Idempotent refunds cannot create negative usage.
  }
  expect(quota.issue("client", now).status).toBe(429);
  expect(quota.issue("client", now).headers.get("Retry-After")).toBe("60");
  await record(quota, "client", now + 60_000);
});

test("unused tickets and interrupted startups are refunded after expiry and restart", async () => {
  const { quota, sql } = setup();
  for (let i = 0; i < 12; i++) await ticket(quota);
  const restarted = new DemoQuota(sql);
  const id = await ticket(restarted, "client", now + 60_000);
  expect(restarted.consume(id, "client", now + 60_000)).toBeUndefined();
  restarted.clean(now + 120_000);
  expect(
    sql
      .exec<{ count: number }>(
        "SELECT count FROM usage WHERE key = 'client:hour'",
      )
      .one().count,
  ).toBe(0);
});

test("a late refund never decrements the next hour's usage", async () => {
  const { quota, sql } = setup();
  const id = await ticket(quota, "client", now + 3_599_000);
  expect(quota.consume(id, "client", now + 3_599_000)).toBeUndefined();
  await record(quota, "other", now + 3_600_000);
  quota.release(id);
  await record(quota, "client", now + 3_600_000);
  quota.release(id);
  expect(
    sql
      .exec<{ count: number }>(
        "SELECT count FROM usage WHERE key = 'client:hour'",
      )
      .one().count,
  ).toBe(1);
});

test("network changes never move quota or concurrency ownership to the new IP", async () => {
  const { quota, sql } = setup();
  const a = await ticket(quota, "issuer");
  const b = await ticket(quota, "issuer");
  expect(quota.consume(a, "websocket-egress-1", now)).toBeUndefined();
  expect(
    sql
      .exec<{ client: string }>("SELECT client FROM active WHERE id = ?", a)
      .one().client,
  ).toBe("issuer");
  expect(quota.consume(b, "websocket-egress-2", now)?.status).toBe(429);
  quota.started(a);
  quota.release(a);
  expect(
    sql
      .exec<{ count: number }>(
        "SELECT count FROM usage WHERE key = 'issuer:hour'",
      )
      .one().count,
  ).toBe(1);
  expect(
    sql
      .exec("SELECT key FROM usage WHERE key = 'websocket-egress-1:hour'")
      .toArray(),
  ).toHaveLength(0);
});

test("a ticket issued before UTC midnight remains valid after the IP hash rotates", async () => {
  const { quota } = setup();
  const midnight = Date.UTC(2026, 8, 6);
  const id = await ticket(quota, "yesterday-hash", midnight - 1000);
  expect(quota.consume(id, "today-hash", midnight + 1000)).toBeUndefined();
  quota.started(id);
  quota.release(id);
  expect(quota.consume(id, "today-hash", midnight + 1001)?.status).toBe(401);
});

test("1000 ticket exchanges across changing networks remain single-use and refund empty starts", async () => {
  const { quota, sql } = setup();
  for (let i = 0; i < 1000; i++) {
    const time = now + i * 2100;
    const id = await ticket(quota, "issuer", time);
    expect(quota.consume(id, `egress-${i % 4}`, time)).toBeUndefined();
    expect(quota.consume(id, "issuer", time)?.status).toBe(401);
    quota.release(id);
  }
  expect(
    sql
      .exec<{ count: number }>(
        "SELECT count FROM usage WHERE key = 'issuer:hour'",
      )
      .one().count,
  ).toBe(0);
  expect(
    sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM active").one()
      .count,
  ).toBe(0);
  expect(
    sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM reservations")
      .one().count,
  ).toBe(0);
});
