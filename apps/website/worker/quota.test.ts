import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { DemoQuota } from "./quota";

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

test("tickets expire, belong to one visitor, and can only be consumed once", async () => {
  const { quota } = setup();
  const first = await ticket(quota);
  expect(quota.consume(first, "different-client", now)?.status).toBe(401);
  expect(quota.consume(first, "client", now)).toBeUndefined();
  expect(quota.consume(first, "client", now)?.status).toBe(401);
  const second = await ticket(quota, "other");
  expect(quota.consume(second, "other", now + 60_000)?.status).toBe(401);
});

test("concurrent reservations cannot bypass the hourly and daily visitor limits", async () => {
  const { quota } = setup();
  const responses = await Promise.all(
    Array.from({ length: 12 }, async () => quota.issue("client", now)),
  );
  expect(responses.filter((r) => r.status === 200)).toHaveLength(3);
  expect(responses.filter((r) => r.status === 429)).toHaveLength(9);
  expect(responses.at(-1)?.headers.get("Retry-After")).toBe("3600");
  for (let i = 0; i < 3; i++) await ticket(quota, "client", now + 3_600_000);
  expect(quota.issue("client", now + 7_200_000).status).toBe(429);
});

test("daily global budget persists across object reconstruction", async () => {
  const { quota, sql } = setup();
  for (let i = 0; i < 100; i++) await ticket(quota, `client-${i}`);
  const restarted = new DemoQuota(sql);
  expect(restarted.issue("new-client", now).status).toBe(429);
  expect(restarted.issue("new-client", now + 86_400_000).status).toBe(200);
});

test("limits concurrent sessions globally and per visitor, then releases slots", async () => {
  const { quota } = setup();
  const first = await ticket(quota);
  expect(quota.consume(first, "client", now)).toBeUndefined();
  const duplicate = await ticket(quota);
  expect(quota.consume(duplicate, "client", now)?.status).toBe(429);
  for (let i = 0; i < 3; i++) {
    const grant = await ticket(quota, `other-${i}`);
    expect(quota.consume(grant, `other-${i}`, now)).toBeUndefined();
  }
  const overflow = await ticket(quota, "overflow");
  expect(quota.consume(overflow, "overflow", now)?.status).toBe(429);
  quota.release(first);
  const next = await ticket(quota, "new");
  expect(quota.consume(next, "new", now)).toBeUndefined();
  expect(quota.consume(overflow, "overflow", now)?.status).toBe(401);
});
