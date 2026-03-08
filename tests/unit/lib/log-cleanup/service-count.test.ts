import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type MockInstance, beforeEach, describe, expect, it, vi } from "vitest";

type ExecuteCountResult = unknown[] & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  count?: any;
  rowCount?: number;
};

vi.mock("@/drizzle/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeExecuteResult(input: {
  count?: number | bigint;
  rowCount?: number;
}): ExecuteCountResult {
  const result: ExecuteCountResult = [];
  if (input.count !== undefined) {
    result.count = input.count;
  }
  if (typeof input.rowCount === "number") {
    result.rowCount = input.rowCount;
  }
  return result;
}

function makeReturningResult(count: number): unknown[] {
  return Array.from({ length: count }, () => ({ "?column?": 1 }));
}

describe("log cleanup delete count", () => {
  beforeEach(async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockReset();
  });

  it("prefers RETURNING array length for row counting", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeReturningResult(5)) // main delete: 5 rows
      .mockResolvedValueOnce([]) // main delete: 0 (exit loop)
      .mockResolvedValueOnce([]) // soft-delete purge: 0 (exit)
      .mockResolvedValueOnce({}); // VACUUM

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(5);
    expect(result.batchCount).toBe(1);
    expect(result.vacuumPerformed).toBe(true);
  });

  it("reads affected rows from postgres.js count field", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeExecuteResult({ count: 3 })) // main delete
      .mockResolvedValueOnce(makeExecuteResult({ count: 0 })) // main delete exit
      .mockResolvedValueOnce([]) // soft-delete purge
      .mockResolvedValueOnce({}); // VACUUM

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(3);
    expect(result.batchCount).toBe(1);
  });

  it("reads affected rows from postgres.js BigInt count field", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeExecuteResult({ count: BigInt(7) }))
      .mockResolvedValueOnce(makeExecuteResult({ count: BigInt(0) }))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({});

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(7);
    expect(result.batchCount).toBe(1);
  });

  it("keeps compatibility with rowCount fallback", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeExecuteResult({ rowCount: 2 }))
      .mockResolvedValueOnce(makeExecuteResult({ rowCount: 0 }))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({});

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(2);
    expect(result.batchCount).toBe(1);
  });

  it("purgeSoftDeleted runs after main cleanup and count returned in result", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeReturningResult(2)) // main delete: 2
      .mockResolvedValueOnce([]) // main delete exit
      .mockResolvedValueOnce(makeReturningResult(4)) // soft-delete purge: 4
      .mockResolvedValueOnce([]) // soft-delete purge exit
      .mockResolvedValueOnce({}); // VACUUM

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(2);
    expect(result.softDeletedPurged).toBe(4);
    expect(result.vacuumPerformed).toBe(true);
  });

  it("VACUUM runs after deletion, failure doesn't fail cleanup", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeReturningResult(1)) // main delete: 1
      .mockResolvedValueOnce([]) // main delete exit
      .mockResolvedValueOnce([]) // soft-delete purge: 0
      .mockRejectedValueOnce(new Error("VACUUM failed")); // VACUUM fails

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(1);
    expect(result.vacuumPerformed).toBe(false);
  });

  it("VACUUM skipped when 0 records deleted", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce([]) // main delete: 0 (exit immediately)
      .mockResolvedValueOnce([]); // soft-delete purge: 0

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      { beforeDate: new Date() },
      {},
      { type: "manual", user: "test" }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(0);
    expect(result.softDeletedPurged).toBe(0);
    expect(result.vacuumPerformed).toBe(false);
    // VACUUM should not have been called (only 2 execute calls total)
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});

describe("getAffectedRows", () => {
  it("returns array length for RETURNING rows", async () => {
    const { getAffectedRows } = await import("@/lib/log-cleanup/service");
    expect(getAffectedRows(makeReturningResult(10))).toBe(10);
  });

  it("falls through to count for empty array with count property", async () => {
    const { getAffectedRows } = await import("@/lib/log-cleanup/service");
    expect(getAffectedRows(makeExecuteResult({ count: 5 }))).toBe(5);
  });

  it("handles BigInt count", async () => {
    const { getAffectedRows } = await import("@/lib/log-cleanup/service");
    expect(getAffectedRows(makeExecuteResult({ count: BigInt(99) }))).toBe(99);
  });

  it("handles rowCount fallback", async () => {
    const { getAffectedRows } = await import("@/lib/log-cleanup/service");
    expect(getAffectedRows(makeExecuteResult({ rowCount: 42 }))).toBe(42);
  });

  it("returns 0 for null/undefined", async () => {
    const { getAffectedRows } = await import("@/lib/log-cleanup/service");
    expect(getAffectedRows(null)).toBe(0);
    expect(getAffectedRows(undefined)).toBe(0);
  });

  it("returns 0 for empty result", async () => {
    const { getAffectedRows } = await import("@/lib/log-cleanup/service");
    expect(getAffectedRows([])).toBe(0);
    expect(getAffectedRows({})).toBe(0);
  });
});

describe("buildWhereConditions", () => {
  it("does not filter on deletedAt", async () => {
    const { buildWhereConditions } = await import("@/lib/log-cleanup/service");
    const conditions = buildWhereConditions({});
    expect(conditions).toHaveLength(0);
  });

  it("returns conditions only for provided filters", async () => {
    const { buildWhereConditions } = await import("@/lib/log-cleanup/service");
    const conditions = buildWhereConditions({
      beforeDate: new Date(),
      userIds: [1, 2],
    });
    // beforeDate + userIds = 2 conditions (no deletedAt)
    expect(conditions).toHaveLength(2);
  });
});

describe("log cleanup SQL patterns", () => {
  const serviceSource = readFileSync(
    resolve(process.cwd(), "src/lib/log-cleanup/service.ts"),
    "utf-8"
  );

  it("uses SKIP LOCKED in delete SQL", () => {
    expect(serviceSource).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("uses RETURNING 1 in delete SQL", () => {
    expect(serviceSource).toContain("RETURNING 1");
  });

  it("does not contain deletedAt IS NULL in buildWhereConditions", () => {
    const buildFnMatch = serviceSource.match(/function buildWhereConditions[\s\S]*?^}/m);
    expect(buildFnMatch).not.toBeNull();
    expect(buildFnMatch![0]).not.toContain("deletedAt");
  });

  it("includes VACUUM ANALYZE", () => {
    expect(serviceSource).toContain("VACUUM ANALYZE message_request");
  });
});
