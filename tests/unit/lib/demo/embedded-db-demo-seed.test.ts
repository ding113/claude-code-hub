import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterAll, describe, expect, test, vi } from "vitest";

function toInt(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number.parseInt(value, 10);
  return Number(value ?? 0);
}

function toRows(result: unknown): unknown[] {
  if (!result) return [];

  if (Array.isArray(result)) {
    return result;
  }

  const maybeResult = result as { rows?: unknown };
  if (Array.isArray(maybeResult.rows)) {
    return maybeResult.rows;
  }

  const maybeIterable = result as { [Symbol.iterator]?: () => Iterator<unknown> };
  if (typeof maybeIterable[Symbol.iterator] === "function") {
    return Array.from(result as Iterable<unknown>);
  }

  return [];
}

function requireSingleRow<T>(result: unknown): T {
  const rows = toRows(result);
  const row = rows[0] as T | undefined;
  if (!row) {
    throw new Error("expected query to return one row");
  }
  return row;
}

describe("demo: embedded db + seed", () => {
  let dataDir: string | null = null;

  afterAll(async () => {
    if (!dataDir) return;
    try {
      await rm(dataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors (e.g. Windows file locks)
    }
  });

  test("runs migrations and seeds demo data on embedded db", { timeout: 60_000 }, async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "cch-pglite-demo-"));

    process.env.NODE_ENV = "development";
    process.env.DSN = "";
    process.env.CCH_EMBEDDED_DB = "true";
    process.env.CCH_EMBEDDED_DB_DIR = dataDir;
    process.env.CCH_DEMO_SEED = "true";
    process.env.ENABLE_RATE_LIMIT = "false";
    process.env.ADMIN_TOKEN = "cch-demo-admin";

    vi.resetModules();

    const { checkDatabaseConnection, runMigrations, withAdvisoryLock } = await import(
      "@/lib/migrate"
    );

    const isConnected = await checkDatabaseConnection();
    expect(isConnected).toBe(true);

    const lockResult = await withAdvisoryLock("cch-demo-lock", async () => 42, {
      skipIfLocked: true,
    });
    expect(lockResult).toEqual({ ran: true, result: 42 });

    await runMigrations();

    const { seedDemoDataIfNeeded } = await import("@/lib/demo/seed");
    await seedDemoDataIfNeeded();

    const { db } = await import("@/drizzle/db");
    const { sql } = await import("drizzle-orm");

    const usersRow = requireSingleRow<{ count: unknown }>(
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM users`)
    );
    expect(toInt(usersRow.count)).toBe(8);

    const keysRow = requireSingleRow<{ count: unknown }>(
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM keys WHERE can_login_web_ui = true`)
    );
    expect(toInt(keysRow.count)).toBe(8);

    const vendorRow = requireSingleRow<{ count: unknown }>(
      await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM provider_vendors WHERE website_domain = 'example.com'`
      )
    );
    expect(toInt(vendorRow.count)).toBe(1);

    const providerRow = requireSingleRow<{ count: unknown }>(
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM providers WHERE name = 'demo-provider'`)
    );
    expect(toInt(providerRow.count)).toBe(1);

    const usageRow = requireSingleRow<{ count: unknown }>(
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM usage_ledger WHERE model = 'demo-model'`)
    );
    expect(toInt(usageRow.count)).toBeGreaterThan(0);

    const priceRow = requireSingleRow<{ count: unknown }>(
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM model_prices WHERE model_name = 'demo-model'`)
    );
    expect(toInt(priceRow.count)).toBe(1);

    await seedDemoDataIfNeeded();

    const usersAfterRow = requireSingleRow<{ count: unknown }>(
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM users`)
    );
    expect(toInt(usersAfterRow.count)).toBe(8);
  });
});
