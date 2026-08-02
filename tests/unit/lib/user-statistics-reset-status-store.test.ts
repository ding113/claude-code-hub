import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  redis: {
    status: "ready",
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  },
  storeSet: vi.fn(),
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => boundary.redis,
}));

vi.mock("@/lib/redis/redis-kv-store", () => ({
  RedisKVStore: class MockRedisKVStore {
    set = boundary.storeSet;
  },
}));

import {
  claimActiveUserStatisticsReset,
  deleteUserStatisticsResetStatus,
  getUserStatisticsResetStatus,
  releaseActiveUserStatisticsReset,
  setUserStatisticsResetStatus,
} from "@/lib/user-statistics-reset/reset-status-store";

const record = {
  resetId: "00000000-0000-4000-8000-000000000001",
  userId: 42,
  status: "queued" as const,
  requestedAt: "2026-08-02T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
  deletedMessageRequests: 0,
  deletedUsageLedger: 0,
  errorCode: null,
  fixed5hKeyIds: [9],
  fixed5hPreparationVersion: null,
};

describe("user statistics reset status store", () => {
  beforeEach(() => {
    boundary.redis.status = "ready";
    for (const mock of [
      boundary.redis.get,
      boundary.redis.set,
      boundary.redis.del,
      boundary.redis.eval,
      boundary.storeSet,
    ]) {
      mock.mockReset();
    }
    boundary.storeSet.mockResolvedValue(true);
  });

  it("writes status records and fails closed when Redis rejects the write", async () => {
    await expect(setUserStatisticsResetStatus(record)).resolves.toBeUndefined();
    expect(boundary.storeSet).toHaveBeenCalledWith(record.resetId, record);

    boundary.storeSet.mockResolvedValue(false);
    await expect(setUserStatisticsResetStatus(record)).rejects.toThrow(
      "USER_STATISTICS_RESET_STATUS_WRITE_FAILED"
    );
  });

  it("reads valid records and distinguishes missing, corrupt, and unavailable state", async () => {
    boundary.redis.get.mockResolvedValueOnce(JSON.stringify(record)).mockResolvedValueOnce(null);

    await expect(getUserStatisticsResetStatus(record.resetId)).resolves.toEqual(record);
    await expect(getUserStatisticsResetStatus(record.resetId)).resolves.toBeNull();

    boundary.redis.get.mockResolvedValue("not-json");
    await expect(getUserStatisticsResetStatus(record.resetId)).rejects.toThrow(
      "USER_STATISTICS_RESET_STATUS_INVALID"
    );

    boundary.redis.status = "connecting";
    await expect(getUserStatisticsResetStatus(record.resetId)).rejects.toThrow(
      "USER_STATISTICS_RESET_REDIS_UNAVAILABLE"
    );
  });

  it("normalizes legacy records without fixed 5h key ids", async () => {
    const {
      fixed5hKeyIds: _fixed5hKeyIds,
      fixed5hPreparationVersion: _fixed5hPreparationVersion,
      ...legacyRecord
    } = record;
    boundary.redis.get.mockResolvedValue(JSON.stringify(legacyRecord));

    await expect(getUserStatisticsResetStatus(record.resetId)).resolves.toEqual({
      ...legacyRecord,
      fixed5hKeyIds: [],
      fixed5hPreparationVersion: null,
    });
  });

  it("claims one active reset and returns the existing owner on contention", async () => {
    boundary.redis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    boundary.redis.get.mockResolvedValue(record.resetId);

    await expect(claimActiveUserStatisticsReset(42, record.resetId)).resolves.toEqual({
      acquired: true,
      resetId: record.resetId,
    });
    await expect(claimActiveUserStatisticsReset(42, "new-reset")).resolves.toEqual({
      acquired: false,
      resetId: record.resetId,
    });
    expect(boundary.redis.set).toHaveBeenCalledWith(
      "cch:user-statistics-reset:active:42",
      record.resetId,
      "EX",
      604_800,
      "NX"
    );
  });

  it("fails contention without an owner and deletes status or claims by exact key", async () => {
    boundary.redis.set.mockResolvedValue(null);
    boundary.redis.get.mockResolvedValue(null);

    await expect(claimActiveUserStatisticsReset(42, record.resetId)).rejects.toThrow(
      "USER_STATISTICS_RESET_ACTIVE_CLAIM_FAILED"
    );

    await deleteUserStatisticsResetStatus(record.resetId);
    await releaseActiveUserStatisticsReset(42, record.resetId);

    expect(boundary.redis.del).toHaveBeenCalledWith(
      `cch:user-statistics-reset:status:${record.resetId}`
    );
    expect(boundary.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      "cch:user-statistics-reset:active:42",
      record.resetId
    );
  });
});
