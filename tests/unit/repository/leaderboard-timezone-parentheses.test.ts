import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for: function pg_catalog.timezone(unknown, interval) does not exist
 *
 * PostgreSQL's `AT TIME ZONE` has higher precedence than `+` / `-`.
 * Without parentheses, `expr + INTERVAL '1 day' AT TIME ZONE tz` is parsed as
 * `expr + (INTERVAL '1 day' AT TIME ZONE tz)`, which applies AT TIME ZONE to
 * an INTERVAL -- an invalid operation.
 *
 * The fix wraps arithmetic in parentheses: `(expr + INTERVAL '1 day') AT TIME ZONE tz`.
 */

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);

    if (typeof node === "object") {
      const anyNode = node as Record<string, unknown>;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value !== undefined) {
        if (Array.isArray(anyNode.value)) {
          return (anyNode.value as unknown[]).map(walk).join("");
        }
        return walk(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

const mocks = vi.hoisted(() => ({
  resolveSystemTimezone: vi.fn(),
}));

function createThenableQuery<T>(result: T, whereArgs?: unknown[]) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    whereArgs?.push(arg);
    return query;
  });
  return query;
}

vi.mock("@/drizzle/db", () => {
  const whereCapture: unknown[] = [];
  return {
    db: {
      select: vi.fn(() => createThenableQuery([], whereCapture)),
    },
    __whereCapture: whereCapture,
  };
});

vi.mock("@/drizzle/schema", () => ({
  usageLedger: {
    userId: "userId",
    providerId: "providerId",
    finalProviderId: "finalProviderId",
    costUsd: "costUsd",
    inputTokens: "inputTokens",
    outputTokens: "outputTokens",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    blockedBy: "blockedBy",
    createdAt: "createdAt",
    ttfbMs: "ttfbMs",
    durationMs: "durationMs",
    statusCode: "statusCode",
    isSuccess: "isSuccess",
    model: "model",
    originalModel: "originalModel",
  },
  messageRequest: {
    deletedAt: "deletedAt",
    providerId: "providerId",
    userId: "userId",
    costUsd: "costUsd",
    inputTokens: "inputTokens",
    outputTokens: "outputTokens",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    errorMessage: "errorMessage",
    blockedBy: "blockedBy",
    createdAt: "createdAt",
    ttfbMs: "ttfbMs",
    durationMs: "durationMs",
    statusCode: "statusCode",
    model: "model",
    originalModel: "originalModel",
  },
  providers: {
    id: "id",
    name: "name",
    deletedAt: "deletedAt",
    providerType: "providerType",
  },
  users: {
    id: "id",
    name: "name",
    deletedAt: "deletedAt",
    tags: "tags",
    providerGroup: "providerGroup",
  },
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn().mockResolvedValue({ billingModelSource: "redirected" }),
}));

describe("buildDateCondition - timezone parentheses regression", () => {
  let whereCapture: unknown[];

  beforeEach(async () => {
    vi.resetModules();
    mocks.resolveSystemTimezone.mockResolvedValue("Asia/Shanghai");

    const dbModule = await import("@/drizzle/db");
    whereCapture = (dbModule as any).__whereCapture;
    whereCapture.length = 0;
  });

  it("daily period: INTERVAL '1 day' must be parenthesized before AT TIME ZONE", async () => {
    const { findDailyLeaderboard } = await import("@/repository/leaderboard");
    await findDailyLeaderboard();

    expect(whereCapture.length).toBeGreaterThan(0);
    const sqlStr = sqlToString(whereCapture[0]);

    // After fix: (... + INTERVAL '1 day') AT TIME ZONE
    // Before fix (bug): ... + INTERVAL '1 day' AT TIME ZONE
    expect(sqlStr).toContain("INTERVAL '1 day')");
    expect(sqlStr).not.toMatch(/INTERVAL '1 day' AT TIME ZONE/);
  });

  it("weekly period: INTERVAL '1 week' must be parenthesized before AT TIME ZONE", async () => {
    const { findWeeklyLeaderboard } = await import("@/repository/leaderboard");
    await findWeeklyLeaderboard();

    expect(whereCapture.length).toBeGreaterThan(0);
    const sqlStr = sqlToString(whereCapture[0]);

    expect(sqlStr).toContain("INTERVAL '1 week')");
    expect(sqlStr).not.toMatch(/INTERVAL '1 week' AT TIME ZONE/);
  });

  it("monthly period: INTERVAL '1 month' must be parenthesized before AT TIME ZONE", async () => {
    const { findMonthlyLeaderboard } = await import("@/repository/leaderboard");
    await findMonthlyLeaderboard();

    expect(whereCapture.length).toBeGreaterThan(0);
    const sqlStr = sqlToString(whereCapture[0]);

    expect(sqlStr).toContain("INTERVAL '1 month')");
    expect(sqlStr).not.toMatch(/INTERVAL '1 month' AT TIME ZONE/);
  });

  it("custom period: already has correct parentheses and should remain correct", async () => {
    const { findCustomRangeLeaderboard } = await import("@/repository/leaderboard");
    await findCustomRangeLeaderboard({ startDate: "2026-01-01", endDate: "2026-01-31" });

    expect(whereCapture.length).toBeGreaterThan(0);
    const sqlStr = sqlToString(whereCapture[0]);

    // Custom period already had correct parentheses before the fix
    expect(sqlStr).toContain("INTERVAL '1 day')");
    expect(sqlStr).not.toMatch(/INTERVAL '1 day' AT TIME ZONE/);
  });
});
