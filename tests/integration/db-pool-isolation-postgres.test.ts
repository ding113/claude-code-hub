import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const HAS_DB = Boolean(process.env.DSN || process.env.DATABASE_URL);
const run = describe.skipIf(!HAS_DB);

run("PostgreSQL pool isolation integration", () => {
  let dbModule: typeof import("@/drizzle/db");
  let previousDsn: string | undefined;
  let previousPoolMax: string | undefined;

  async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    return Array.from(await dbModule.getDb().execute(query)) as T[];
  }

  async function waitForActiveDataConnections(expected: number): Promise<void> {
    const deadline = performance.now() + 2_000;
    while (performance.now() < deadline) {
      const [row] = await rows<{ active: number }>(sql`
        SELECT COUNT(*)::int AS active
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name = 'claude-code-hub:data'
          AND state = 'active'
      `);
      if (Number(row?.active ?? 0) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expected} active data connections`);
  }

  async function startDataSleep(seconds: number): Promise<void> {
    return dbModule.runWithDataDbScope(async () => {
      await dbModule.getDb().execute(sql`SELECT pg_sleep(${seconds})`);
    });
  }

  beforeAll(async () => {
    previousDsn = process.env.DSN;
    previousPoolMax = process.env.DB_POOL_MAX;
    if (!process.env.DSN && process.env.DATABASE_URL) {
      process.env.DSN = process.env.DATABASE_URL;
    }
    process.env.DB_POOL_MAX = "6";
    vi.resetModules();
    dbModule = await import("@/drizzle/db");
  });

  afterAll(async () => {
    try {
      await dbModule.closeDbPools();
    } finally {
      if (previousPoolMax === undefined) {
        delete process.env.DB_POOL_MAX;
      } else {
        process.env.DB_POOL_MAX = previousPoolMax;
      }
      if (previousDsn === undefined) {
        delete process.env.DSN;
      } else {
        process.env.DSN = previousDsn;
      }
    }
  });

  test("creates observable data, control, and writer lanes", async () => {
    await dbModule.getDb().execute(sql`SELECT 1`);
    await dbModule.runWithDataDbScope(() => dbModule.getDb().execute(sql`SELECT 1`));
    await dbModule.getMessageWriterDb().execute(sql`SELECT 1`);

    const activity = await rows<{ applicationName: string; connections: number }>(sql`
      SELECT application_name AS "applicationName", COUNT(*)::int AS connections
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name IN (
          'claude-code-hub:data',
          'claude-code-hub:control',
          'claude-code-hub:writer'
        )
      GROUP BY application_name
    `);

    expect(new Set(activity.map(({ applicationName }) => applicationName))).toEqual(
      new Set(["claude-code-hub:data", "claude-code-hub:control", "claude-code-hub:writer"])
    );
  });

  test("keeps control and writer queries responsive while every data connection is busy", async () => {
    const dataSleeps = Array.from({ length: 4 }, () => startDataSleep(0.5));
    await waitForActiveDataConnections(4);

    const startedAt = performance.now();
    await Promise.all([
      dbModule.getDb().execute(sql`SELECT 1`),
      dbModule.getMessageWriterDb().execute(sql`SELECT 1`),
    ]);
    const isolatedLatencyMs = performance.now() - startedAt;

    expect(isolatedLatencyMs).toBeLessThan(300);
    await Promise.all(dataSleeps);
  });

  test("rejects the 33rd outstanding data query before it joins the postgres.js queue", async () => {
    const pending = Array.from({ length: 32 }, () => startDataSleep(0.2));

    const rejectedAt = performance.now();
    let admissionError: unknown;
    try {
      await startDataSleep(0.2);
    } catch (error) {
      admissionError = error;
    }
    const rejectionLatencyMs = performance.now() - rejectedAt;

    expect(admissionError).toMatchObject({
      cause: {
        name: "DbPoolAdmissionError",
        code: "DB_POOL_ADMISSION_EXCEEDED",
        pool: "data",
        maxOutstanding: 32,
      },
    });
    expect(rejectionLatencyMs).toBeLessThan(50);

    const controlAndWriterStartedAt = performance.now();
    await Promise.all([
      dbModule.getDb().execute(sql`SELECT 1`),
      dbModule.getMessageWriterDb().execute(sql`SELECT 1`),
    ]);
    expect(performance.now() - controlAndWriterStartedAt).toBeLessThan(300);

    await Promise.all(pending);
  });
});
