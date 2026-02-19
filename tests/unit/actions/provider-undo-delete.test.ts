import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "../../../src/lib/provider-batch-patch-error-codes";

const getSessionMock = vi.fn();
const deleteProvidersBatchMock = vi.fn();
const restoreProvidersBatchMock = vi.fn();
const publishCacheInvalidationMock = vi.fn();
const clearProviderStateMock = vi.fn();
const clearConfigCacheMock = vi.fn();
const redisStore = new Map<string, { value: string; expiresAt: number }>();

function readRedisValue(key: string): string | null {
  const entry = redisStore.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    redisStore.delete(key);
    return null;
  }

  return entry.value;
}

const redisSetexMock = vi.fn(async (key: string, ttlSeconds: number, value: string) => {
  redisStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return "OK";
});

const redisGetMock = vi.fn(async (key: string) => readRedisValue(key));

const redisDelMock = vi.fn(async (key: string) => {
  const existed = redisStore.delete(key);
  return existed ? 1 : 0;
});

const redisEvalMock = vi.fn(async (_script: string, _numKeys: number, key: string) => {
  const value = readRedisValue(key);
  if (value === null) {
    return null;
  }
  redisStore.delete(key);
  return value;
});

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  deleteProvidersBatch: deleteProvidersBatchMock,
  findAllProvidersFresh: vi.fn(),
  updateProvidersBatch: vi.fn(),
}));

vi.mock("@/repository", () => ({
  restoreProvidersBatch: restoreProvidersBatchMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishCacheInvalidationMock,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearProviderState: clearProviderStateMock,
  clearConfigCache: clearConfigCacheMock,
  resetCircuit: vi.fn(),
  getAllHealthStatusAsync: vi.fn(),
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => ({
    status: "ready",
    setex: redisSetexMock,
    get: redisGetMock,
    del: redisDelMock,
    eval: redisEvalMock,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Provider Delete Undo Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    redisStore.clear();
    redisSetexMock.mockClear();
    redisGetMock.mockClear();
    redisDelMock.mockClear();
    redisEvalMock.mockClear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    deleteProvidersBatchMock.mockResolvedValue(2);
    restoreProvidersBatchMock.mockResolvedValue(2);
    publishCacheInvalidationMock.mockResolvedValue(undefined);
    clearProviderStateMock.mockReturnValue(undefined);
    clearConfigCacheMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batchDeleteProviders should return undoToken and operationId", async () => {
    const { batchDeleteProviders } = await import("../../../src/actions/providers");
    const result = await batchDeleteProviders({ providerIds: [3, 1, 3] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(deleteProvidersBatchMock).toHaveBeenCalledWith([1, 3]);
    expect(result.data.deletedCount).toBe(2);
    expect(result.data.undoToken).toMatch(/^provider_patch_undo_/);
    expect(result.data.operationId).toMatch(/^provider_patch_apply_/);
  });

  it("batchDeleteProviders should return repository errors", async () => {
    deleteProvidersBatchMock.mockRejectedValueOnce(new Error("delete failed"));

    const { batchDeleteProviders } = await import("../../../src/actions/providers");
    const result = await batchDeleteProviders({ providerIds: [7] });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("delete failed");
  });

  it("batchDeleteProviders should reject non-admin session", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 3, role: "user" } });

    const { batchDeleteProviders } = await import("../../../src/actions/providers");
    const result = await batchDeleteProviders({ providerIds: [1] });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("无权限执行此操作");
    expect(deleteProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("batchDeleteProviders should reject empty provider list", async () => {
    const { batchDeleteProviders } = await import("../../../src/actions/providers");
    const result = await batchDeleteProviders({ providerIds: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("请选择要删除的供应商");
    expect(deleteProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("batchDeleteProviders should reject provider lists over max size", async () => {
    const { batchDeleteProviders } = await import("../../../src/actions/providers");
    const result = await batchDeleteProviders({
      providerIds: Array.from({ length: 501 }, (_, index) => index + 1),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("单次批量操作最多支持");
    expect(deleteProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderDelete should restore providers by snapshot", async () => {
    const { batchDeleteProviders, undoProviderDelete } = await import(
      "../../../src/actions/providers"
    );

    const deleted = await batchDeleteProviders({ providerIds: [2, 4] });
    if (!deleted.ok) throw new Error(`Delete should succeed: ${deleted.error}`);

    restoreProvidersBatchMock.mockClear();
    publishCacheInvalidationMock.mockClear();
    clearProviderStateMock.mockClear();
    clearConfigCacheMock.mockClear();

    const undone = await undoProviderDelete({
      undoToken: deleted.data.undoToken,
      operationId: deleted.data.operationId,
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    expect(restoreProvidersBatchMock).toHaveBeenCalledWith([2, 4]);
    expect(undone.data.operationId).toBe(deleted.data.operationId);
    expect(undone.data.restoredCount).toBe(2);
    expect(clearProviderStateMock).toHaveBeenCalledTimes(2);
    expect(clearConfigCacheMock).toHaveBeenCalledTimes(2);
    expect(publishCacheInvalidationMock).toHaveBeenCalledTimes(1);
  });

  it("undoProviderDelete should expire after 61 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T00:00:00.000Z"));

    const { batchDeleteProviders, undoProviderDelete } = await import(
      "../../../src/actions/providers"
    );

    const deleted = await batchDeleteProviders({ providerIds: [9] });
    if (!deleted.ok) throw new Error(`Delete should succeed: ${deleted.error}`);

    restoreProvidersBatchMock.mockClear();
    vi.advanceTimersByTime(61_000);

    const undone = await undoProviderDelete({
      undoToken: deleted.data.undoToken,
      operationId: deleted.data.operationId,
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED);
    expect(restoreProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderDelete should reject mismatched operation id", async () => {
    const { batchDeleteProviders, undoProviderDelete } = await import(
      "../../../src/actions/providers"
    );

    const deleted = await batchDeleteProviders({ providerIds: [10, 11] });
    if (!deleted.ok) throw new Error(`Delete should succeed: ${deleted.error}`);

    restoreProvidersBatchMock.mockClear();

    const undone = await undoProviderDelete({
      undoToken: deleted.data.undoToken,
      operationId: `${deleted.data.operationId}-mismatch`,
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_CONFLICT);
    expect(restoreProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderDelete should reject invalid payload", async () => {
    const { undoProviderDelete } = await import("../../../src/actions/providers");

    const undone = await undoProviderDelete({
      undoToken: "",
      operationId: "provider_patch_apply_x",
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.errorCode).toBeDefined();
    expect(restoreProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderDelete should reject non-admin session", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

    const { undoProviderDelete } = await import("../../../src/actions/providers");

    const undone = await undoProviderDelete({
      undoToken: "provider_patch_undo_x",
      operationId: "provider_patch_apply_x",
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.error).toBe("无权限执行此操作");
    expect(restoreProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderDelete should return repository errors when restore fails", async () => {
    const { batchDeleteProviders, undoProviderDelete } = await import(
      "../../../src/actions/providers"
    );

    const deleted = await batchDeleteProviders({ providerIds: [12] });
    if (!deleted.ok) throw new Error(`Delete should succeed: ${deleted.error}`);

    restoreProvidersBatchMock.mockRejectedValueOnce(new Error("restore failed"));

    const undone = await undoProviderDelete({
      undoToken: deleted.data.undoToken,
      operationId: deleted.data.operationId,
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.error).toBe("restore failed");
  });
});
