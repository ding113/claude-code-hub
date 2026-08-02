import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  transactionResults: [] as unknown[],
  transactionQueries: [] as unknown[],
  executeResults: [] as unknown[],
  executeQueries: [] as unknown[],
  userKeys: [] as { id: number; key: string }[],
  cacheResult: { costKeysDeleted: 0, activeSessionsDeleted: 0, durationMs: 1 } as unknown,
  clearUserCostCache: vi.fn(),
  invalidateCachedUser: vi.fn(),
  updateSet: null as Record<string, unknown> | null,
  updateError: null as Error | null,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: async (
      callback: (tx: { execute: (query: unknown) => Promise<unknown> }) => unknown
    ) =>
      callback({
        execute: async (query: unknown) => {
          boundary.transactionQueries.push(query);
          const result = boundary.transactionResults.shift();
          if (result instanceof Error) throw result;
          return result;
        },
      }),
    execute: async (query: unknown) => {
      boundary.executeQueries.push(query);
      const result = boundary.executeResults.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    select: () => ({ from: () => ({ where: async () => boundary.userKeys }) }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        boundary.updateSet = value;
        return {
          where: async () => {
            if (boundary.updateError) throw boundary.updateError;
          },
        };
      },
    }),
  },
}));
vi.mock("@/lib/redis/cost-cache-cleanup", () => ({
  clearUserCostCache: boundary.clearUserCostCache,
}));
vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedUser: boundary.invalidateCachedUser,
}));

import {
  executeUserStatisticsReset,
  type UserStatisticsResetError,
} from "@/lib/user-statistics-reset/reset-service";

const dialect = new PgDialect();
const sqlText = (query: unknown) => dialect.sqlToQuery(query as SQL).sql.toLowerCase();

describe("executeUserStatisticsReset", () => {
  beforeEach(() => {
    boundary.transactionResults = [];
    boundary.transactionQueries = [];
    boundary.executeResults = [];
    boundary.executeQueries = [];
    boundary.userKeys = [{ id: 9, key: "key-hash" }];
    boundary.updateSet = null;
    boundary.updateError = null;
    boundary.clearUserCostCache.mockReset().mockResolvedValue(boundary.cacheResult);
    boundary.invalidateCachedUser.mockReset().mockResolvedValue(undefined);
  });

  it("deletes both tables in independent cutoff batches and preserves active sessions", async () => {
    boundary.transactionResults = [{ count: 1000 }, { count: 7 }, { count: 3 }];
    boundary.executeResults = [[{ exists: false }], [{ exists: false }]];

    await expect(
      executeUserStatisticsReset({ userId: 42, requestedAt: "2026-08-02T12:00:00.000Z" })
    ).resolves.toEqual({ deletedMessageRequests: 1007, deletedUsageLedger: 3 });

    expect(boundary.transactionQueries).toHaveLength(3);
    expect(sqlText(boundary.transactionQueries[0])).toContain("from message_request");
    expect(sqlText(boundary.transactionQueries[0])).toContain("created_at is null");
    expect(sqlText(boundary.transactionQueries[0])).toContain("created_at <= $2");
    expect(sqlText(boundary.transactionQueries[0])).toContain("limit $3");
    expect(sqlText(boundary.transactionQueries[0])).toContain("for update skip locked");
    expect(sqlText(boundary.transactionQueries[2])).toContain("from usage_ledger");
    expect(boundary.clearUserCostCache).toHaveBeenCalledWith({
      userId: 42,
      keyIds: [9],
      keyHashes: ["key-hash"],
      includeActiveSessions: false,
      allowWhenRateLimitDisabled: true,
    });
    expect(sqlText(boundary.updateSet?.costResetAt)).toContain("case when");
    expect(sqlText(boundary.updateSet?.limit5hCostResetAt)).toContain("case when");
  });

  it("reports deleted rows when cache cleanup fails so retries preserve progress", async () => {
    boundary.transactionResults = [{ count: 4 }, { count: 6 }];
    boundary.executeResults = [[{ exists: false }], [{ exists: false }]];
    boundary.clearUserCostCache.mockResolvedValue({ cleanupFailed: true });

    await expect(
      executeUserStatisticsReset({ userId: 42, requestedAt: "2026-08-02T12:00:00.000Z" })
    ).rejects.toEqual(
      expect.objectContaining<UserStatisticsResetError>({
        code: "USER_STATISTICS_RESET_CACHE_CLEANUP_FAILED",
        progress: { deletedMessageRequests: 4, deletedUsageLedger: 6 },
      })
    );
  });

  it("fails retryably when an empty batch still has locked cutoff rows", async () => {
    boundary.transactionResults = [{ count: 0 }];
    boundary.executeResults = [[{ exists: true }]];

    await expect(
      executeUserStatisticsReset({ userId: 42, requestedAt: "2026-08-02T12:00:00.000Z" })
    ).rejects.toEqual(
      expect.objectContaining<UserStatisticsResetError>({
        code: "USER_STATISTICS_RESET_ROWS_LOCKED",
      })
    );
    expect(boundary.clearUserCostCache).not.toHaveBeenCalled();
  });

  it("preserves completed message deletion progress when ledger deletion throws", async () => {
    boundary.transactionResults = [{ count: 4 }, new Error("ledger unavailable")];
    boundary.executeResults = [[{ exists: false }]];

    await expect(
      executeUserStatisticsReset({ userId: 42, requestedAt: "2026-08-02T12:00:00.000Z" })
    ).rejects.toEqual(
      expect.objectContaining<UserStatisticsResetError>({
        code: "USER_STATISTICS_RESET_OPERATION_FAILED",
        progress: { deletedMessageRequests: 4, deletedUsageLedger: 0 },
      })
    );
  });

  it("preserves progress when a later batch fails", async () => {
    boundary.transactionResults = [{ count: 1000 }, new Error("statement timeout")];

    await expect(
      executeUserStatisticsReset({ userId: 42, requestedAt: "2026-08-02T12:00:00.000Z" })
    ).rejects.toEqual(
      expect.objectContaining<UserStatisticsResetError>({
        code: "USER_STATISTICS_RESET_OPERATION_FAILED",
        progress: { deletedMessageRequests: 1000, deletedUsageLedger: 0 },
      })
    );
  });

  it("preserves both table counts when marker cleanup fails", async () => {
    boundary.transactionResults = [{ count: 4 }, { count: 6 }];
    boundary.executeResults = [[{ exists: false }], [{ exists: false }]];
    boundary.updateError = new Error("database unavailable");

    await expect(
      executeUserStatisticsReset({ userId: 42, requestedAt: "2026-08-02T12:00:00.000Z" })
    ).rejects.toEqual(
      expect.objectContaining<UserStatisticsResetError>({
        code: "USER_STATISTICS_RESET_OPERATION_FAILED",
        progress: { deletedMessageRequests: 4, deletedUsageLedger: 6 },
      })
    );
  });
});
