import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, test, vi } from "vitest";

const HAS_DB = Boolean(process.env.DSN || process.env.DATABASE_URL);
const run = describe.skipIf(!HAS_DB);

const CLEANUP_BOUNDARY_MODULES = [
  "@/lib/cache/session-cache",
  "@/lib/provider-endpoints/probe-scheduler",
  "@/lib/public-status/scheduler",
  "@/lib/provider-endpoints/probe-log-cleanup",
  "@/lib/async-task-manager",
  "@/repository/message-write-buffer",
  "@/lib/langfuse",
  "@/lib/redis",
] as const;

interface ActivityRow {
  state: string;
  waitEventType: string | null;
  waitEvent: string | null;
}

interface ConnectionRow {
  applicationName: string;
  connections: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function observeSettlement(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return () => settled;
}

async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  description: string,
  timeoutMs = 3_000
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

run.sequential("PostgreSQL slow pool close integration", () => {
  test("keeps cleanup attached to an advisory-lock-blocked data query until every pool closes", async () => {
    const originalEnv = {
      DSN: process.env.DSN,
      DB_POOL_MAX: process.env.DB_POOL_MAX,
      DB_LOCK_TIMEOUT_MS: process.env.DB_LOCK_TIMEOUT_MS,
      DB_STATEMENT_TIMEOUT_MS: process.env.DB_STATEMENT_TIMEOUT_MS,
    };
    const dsn = process.env.DSN ?? process.env.DATABASE_URL;
    if (!dsn) throw new Error("DSN or DATABASE_URL is required");

    process.env.DSN = dsn;
    process.env.DB_POOL_MAX = "3";
    process.env.DB_LOCK_TIMEOUT_MS = "4000";
    process.env.DB_STATEMENT_TIMEOUT_MS = "10000";

    // tests/setup.ts 可能已通过旧 module instance 建立 control pool。先用 public close
    // 清空该 harness 连接，再 reset 出本测试独占的三 lane，避免失去旧 pool 的 close handle。
    const harnessDbModule = await import("@/drizzle/db");
    await harnessDbModule.closeDbPools();
    vi.resetModules();

    const holder = postgres(dsn, {
      max: 1,
      connect_timeout: 5,
      connection: { application_name: "cch-pool-close-test:holder" },
    });
    const observer = postgres(dsn, {
      max: 1,
      connect_timeout: 5,
      connection: { application_name: "cch-pool-close-test:observer" },
    });

    const lockNamespace = 0x434348;
    const lockId = Math.floor(Math.random() * 1_000_000_000);
    let lockHeld = false;
    let dbModule: typeof import("@/drizzle/db") | undefined;
    let activeQuery: Promise<void> | undefined;
    let closePromise: Promise<void> | undefined;
    let cleanup: Promise<void> | undefined;

    try {
      const [{ databaseName }] = await observer<{ databaseName: string }[]>`
        SELECT current_database() AS "databaseName"
      `;
      expect(databaseName).toMatch(/test/i);

      await holder`SELECT pg_advisory_lock(${lockNamespace}, ${lockId})`;
      lockHeld = true;

      vi.doMock("@/lib/cache/session-cache", () => ({ stopCacheCleanup: vi.fn() }));
      vi.doMock("@/lib/provider-endpoints/probe-scheduler", () => ({
        stopEndpointProbeScheduler: vi.fn(),
      }));
      vi.doMock("@/lib/public-status/scheduler", () => ({
        stopPublicStatusRebuildScheduler: vi.fn(async () => {}),
      }));
      vi.doMock("@/lib/provider-endpoints/probe-log-cleanup", () => ({
        stopEndpointProbeLogCleanup: vi.fn(),
      }));
      vi.doMock("@/lib/async-task-manager", () => ({
        shutdownAllAsyncTasks: vi.fn(async () => {}),
      }));
      vi.doMock("@/repository/message-write-buffer", () => ({
        stopMessageRequestWriteBuffer: vi.fn(async () => {}),
      }));
      vi.doMock("@/lib/langfuse", () => ({ shutdownLangfuse: vi.fn(async () => {}) }));
      vi.doMock("@/lib/redis", () => ({ closeRedis: vi.fn(async () => {}) }));

      dbModule = await import("@/drizzle/db");
      const { runApplicationCleanup } = await import("@/lib/lifecycle/shutdown");

      await Promise.all([
        dbModule.getDb().execute(sql`SELECT 1`),
        dbModule.runWithDataDbScope(() => dbModule?.getDb().execute(sql`SELECT 1`)),
        dbModule.getMessageWriterDb().execute(sql`SELECT 1`),
      ]);

      const warmedConnections = await observer<ConnectionRow[]>`
        SELECT application_name AS "applicationName", COUNT(*)::int AS connections
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name IN (
            'claude-code-hub:data',
            'claude-code-hub:control',
            'claude-code-hub:writer'
          )
        GROUP BY application_name
      `;
      expect(
        new Set(
          warmedConnections
            .filter(({ connections }) => connections > 0)
            .map(({ applicationName }) => applicationName)
        )
      ).toEqual(
        new Set(["claude-code-hub:data", "claude-code-hub:control", "claude-code-hub:writer"])
      );

      activeQuery = dbModule
        .runWithDataDbScope(() =>
          dbModule?.getDb().execute(sql`SELECT pg_advisory_xact_lock(${lockNamespace}, ${lockId})`)
        )
        .then(() => undefined);
      const isActiveQuerySettled = observeSettlement(activeQuery);

      const blockedActivity = await waitFor<ActivityRow>(async () => {
        const [row] = await observer<ActivityRow[]>`
          SELECT
            state,
            wait_event_type AS "waitEventType",
            wait_event AS "waitEvent"
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = 'claude-code-hub:data'
            AND query LIKE '%pg_advisory_xact_lock%'
          ORDER BY query_start DESC
          LIMIT 1
        `;
        if (
          row?.state === "active" &&
          row.waitEventType === "Lock" &&
          row.waitEvent === "advisory"
        ) {
          return row;
        }
        return undefined;
      }, "data query to wait on an advisory lock");
      expect(blockedActivity).toEqual({
        state: "active",
        waitEventType: "Lock",
        waitEvent: "advisory",
      });

      const perStepTimeoutMs = 50;
      const totalTimeoutMs = 100;
      cleanup = runApplicationCleanup("integration-test", {
        perStepTimeoutMs,
        totalTimeoutMs,
      });
      const isCleanupSettled = observeSettlement(cleanup);

      await waitFor(() => {
        try {
          dbModule?.getDb();
          return undefined;
        } catch (error) {
          if (error instanceof Error && error.message === "Database pools are closing") {
            return true;
          }
          throw error;
        }
      }, "database pools to enter closing state");

      const firstClose = dbModule.closeDbPools();
      const secondClose = dbModule.closeDbPools();
      expect(firstClose).toBe(secondClose);
      closePromise = firstClose;
      const isCloseSettled = observeSettlement(closePromise);

      expect(() => dbModule?.getDb()).toThrow("Database pools are closing");
      expect(() => dbModule?.runWithDataDbScope(() => dbModule?.getDb())).toThrow(
        "Database pools are closing"
      );
      expect(() => dbModule?.getMessageWriterDb()).toThrow("Database pools are closing");

      await delay(totalTimeoutMs + perStepTimeoutMs);

      expect(isActiveQuerySettled()).toBe(false);
      expect(isCloseSettled()).toBe(false);
      expect(isCleanupSettled()).toBe(false);

      const [{ unlocked }] = await holder<{ unlocked: boolean }[]>`
        SELECT pg_advisory_unlock(${lockNamespace}, ${lockId}) AS unlocked
      `;
      expect(unlocked).toBe(true);
      lockHeld = false;

      await Promise.all([activeQuery, closePromise, cleanup]);

      await waitFor(async () => {
        const [{ connections }] = await observer<{ connections: number }[]>`
          SELECT COUNT(*)::int AS connections
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name IN (
              'claude-code-hub:data',
              'claude-code-hub:control',
              'claude-code-hub:writer'
            )
        `;
        return connections === 0 ? true : undefined;
      }, "all production database connections to close");
    } finally {
      if (lockHeld) {
        await holder`SELECT pg_advisory_unlock(${lockNamespace}, ${lockId})`;
      }

      const pending: Promise<unknown>[] = [];
      if (activeQuery) pending.push(activeQuery);
      if (dbModule) pending.push(dbModule.closeDbPools());
      if (closePromise) pending.push(closePromise);
      if (cleanup) pending.push(cleanup);
      await Promise.allSettled(pending);
      await Promise.allSettled([holder.end({ timeout: 1 }), observer.end({ timeout: 1 })]);

      for (const moduleId of CLEANUP_BOUNDARY_MODULES) {
        vi.doUnmock(moduleId);
      }
      vi.resetModules();

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
