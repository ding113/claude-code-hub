import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock logger
const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

// Mock Redis
const redisPipelineMock = {
  del: vi.fn().mockReturnThis(),
  exec: vi.fn(),
};
const redisMock = {
  status: "ready" as string,
  pipeline: vi.fn(() => redisPipelineMock),
};
const getRedisClientMock = vi.fn(() => redisMock);
vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

// Mock scanPattern
const scanPatternMock = vi.fn();
vi.mock("@/lib/redis/scan-helper", () => ({
  scanPattern: scanPatternMock,
}));

// Mock active-session-keys
vi.mock("@/lib/redis/active-session-keys", () => ({
  getKeyActiveSessionsKey: (keyId: number) => `{active_sessions}:key:${keyId}:active_sessions`,
  getUserActiveSessionsKey: (userId: number) => `{active_sessions}:user:${userId}:active_sessions`,
}));

describe("clearUserCostCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.status = "ready";
    redisPipelineMock.exec.mockResolvedValue([]);
    scanPatternMock.mockResolvedValue([]);
  });

  test("scans correct Redis patterns for keyIds, userId, keyHashes", async () => {
    scanPatternMock.mockResolvedValue([]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    await clearUserCostCache({
      userId: 10,
      keyIds: [1, 2],
      keyHashes: ["hash-a", "hash-b"],
    });

    const calls = scanPatternMock.mock.calls.map(([_redis, pattern]: [unknown, string]) => pattern);
    // Per-key cost counters
    expect(calls).toContain("key:1:cost_*");
    expect(calls).toContain("key:2:cost_*");
    // User cost counters
    expect(calls).toContain("user:10:cost_*");
    // Total cost cache (user)
    expect(calls).toContain("total_cost:user:10");
    expect(calls).toContain("total_cost:user:10:*");
    // Total cost cache (key hashes)
    expect(calls).toContain("total_cost:key:hash-a");
    expect(calls).toContain("total_cost:key:hash-a:*");
    expect(calls).toContain("total_cost:key:hash-b");
    expect(calls).toContain("total_cost:key:hash-b:*");
    // Lease cache
    expect(calls).toContain("lease:key:1:*");
    expect(calls).toContain("lease:key:2:*");
    expect(calls).toContain("lease:user:10:*");
  });

  test("pipeline deletes all found keys", async () => {
    scanPatternMock.mockImplementation(async (_redis: unknown, pattern: string) => {
      if (pattern === "key:1:cost_*") return ["key:1:cost_daily", "key:1:cost_5h"];
      if (pattern === "user:10:cost_*") return ["user:10:cost_monthly"];
      return [];
    });
    redisPipelineMock.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
      [null, 1],
    ]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
    });

    expect(result).not.toBeNull();
    expect(result!.costKeysDeleted).toBe(3);
    expect(redisPipelineMock.del).toHaveBeenCalledWith("key:1:cost_daily");
    expect(redisPipelineMock.del).toHaveBeenCalledWith("key:1:cost_5h");
    expect(redisPipelineMock.del).toHaveBeenCalledWith("user:10:cost_monthly");
    expect(redisPipelineMock.exec).toHaveBeenCalled();
  });

  test("returns metrics (costKeysDeleted, activeSessionsDeleted, durationMs)", async () => {
    scanPatternMock.mockImplementation(async (_redis: unknown, pattern: string) => {
      if (pattern === "key:1:cost_*") return ["key:1:cost_daily"];
      return [];
    });
    redisPipelineMock.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
      [null, 1],
    ]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
      includeActiveSessions: true,
    });

    expect(result).not.toBeNull();
    expect(result!.costKeysDeleted).toBe(1);
    // 1 key session + 1 user session = 2
    expect(result!.activeSessionsDeleted).toBe(2);
    expect(typeof result!.durationMs).toBe("number");
    expect(result!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns null when Redis not ready", async () => {
    redisMock.status = "connecting";

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
    });

    expect(result).toBeNull();
    expect(scanPatternMock).not.toHaveBeenCalled();
  });

  test("returns null when Redis client is null", async () => {
    getRedisClientMock.mockReturnValue(null);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
    });

    expect(result).toBeNull();
  });

  test("includeActiveSessions=true adds session key DELs", async () => {
    scanPatternMock.mockResolvedValue([]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1, 2],
      keyHashes: [],
      includeActiveSessions: true,
    });

    expect(result).not.toBeNull();
    // 2 key sessions + 1 user session
    expect(result!.activeSessionsDeleted).toBe(3);
    expect(redisPipelineMock.del).toHaveBeenCalledWith("{active_sessions}:key:1:active_sessions");
    expect(redisPipelineMock.del).toHaveBeenCalledWith("{active_sessions}:key:2:active_sessions");
    expect(redisPipelineMock.del).toHaveBeenCalledWith("{active_sessions}:user:10:active_sessions");
  });

  test("includeActiveSessions=false skips session keys", async () => {
    scanPatternMock.mockImplementation(async (_redis: unknown, pattern: string) => {
      if (pattern === "key:1:cost_*") return ["key:1:cost_daily"];
      return [];
    });

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
      includeActiveSessions: false,
    });

    expect(result).not.toBeNull();
    expect(result!.activeSessionsDeleted).toBe(0);
    // Only cost key deleted, no session keys
    const delCalls = redisPipelineMock.del.mock.calls.map(([k]: [string]) => k);
    expect(delCalls).not.toContain("{active_sessions}:key:1:active_sessions");
    expect(delCalls).not.toContain("{active_sessions}:user:10:active_sessions");
  });

  test("empty scan results -- no pipeline created, returns zeros", async () => {
    scanPatternMock.mockResolvedValue([]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
      includeActiveSessions: false,
    });

    expect(result).not.toBeNull();
    expect(result!.costKeysDeleted).toBe(0);
    expect(result!.activeSessionsDeleted).toBe(0);
    // No pipeline created when nothing to delete
    expect(redisMock.pipeline).not.toHaveBeenCalled();
  });

  test("pipeline partial failures -- logged, does not throw", async () => {
    scanPatternMock.mockImplementation(async (_redis: unknown, pattern: string) => {
      if (pattern === "key:1:cost_*") return ["key:1:cost_daily", "key:1:cost_5h"];
      return [];
    });
    redisPipelineMock.exec.mockResolvedValue([
      [null, 1],
      [new Error("Connection reset"), null],
    ]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await clearUserCostCache({
      userId: 10,
      keyIds: [1],
      keyHashes: [],
    });

    expect(result).not.toBeNull();
    expect(result!.costKeysDeleted).toBe(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Some Redis deletes failed during cost cache cleanup",
      expect.objectContaining({ errorCount: 1, userId: 10 })
    );
  });

  test("no keys (empty keyIds/keyHashes) -- only user patterns scanned", async () => {
    scanPatternMock.mockResolvedValue([]);

    const { clearUserCostCache } = await import("@/lib/redis/cost-cache-cleanup");
    await clearUserCostCache({
      userId: 10,
      keyIds: [],
      keyHashes: [],
    });

    const calls = scanPatternMock.mock.calls.map(([_redis, pattern]: [unknown, string]) => pattern);
    // Only user-level patterns (no key:* or total_cost:key:* patterns)
    expect(calls).toContain("user:10:cost_*");
    expect(calls).toContain("total_cost:user:10");
    expect(calls).toContain("total_cost:user:10:*");
    expect(calls).toContain("lease:user:10:*");
    // No key-specific patterns
    expect(calls.filter((p: string) => p.startsWith("key:"))).toHaveLength(0);
    expect(calls.filter((p: string) => p.startsWith("total_cost:key:"))).toHaveLength(0);
    expect(calls.filter((p: string) => p.startsWith("lease:key:"))).toHaveLength(0);
  });
});
