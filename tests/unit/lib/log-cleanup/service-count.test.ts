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

describe("log cleanup delete count", () => {
  beforeEach(async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance).mockReset();
  });

  it("reads affected rows from postgres.js count field", async () => {
    const { db } = await import("@/drizzle/db");
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeExecuteResult({ count: 3 }))
      .mockResolvedValueOnce(makeExecuteResult({ count: 0 }));

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      {
        beforeDate: new Date(),
      },
      {},
      {
        type: "manual",
        user: "test",
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(3);
    expect(result.batchCount).toBe(1);
  });

  it("reads affected rows from postgres.js BigInt count field", async () => {
    const { db } = await import("@/drizzle/db");
    // postgres.js returns count as BigInt in some versions
    (db.execute as MockInstance)
      .mockResolvedValueOnce(makeExecuteResult({ count: BigInt(7) }))
      .mockResolvedValueOnce(makeExecuteResult({ count: BigInt(0) }));

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
      .mockResolvedValueOnce(makeExecuteResult({ rowCount: 0 }));

    const { cleanupLogs } = await import("@/lib/log-cleanup/service");
    const result = await cleanupLogs(
      {
        beforeDate: new Date(),
      },
      {},
      {
        type: "manual",
        user: "test",
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.totalDeleted).toBe(2);
    expect(result.batchCount).toBe(1);
  });
});
