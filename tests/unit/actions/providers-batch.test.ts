import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

const updateProvidersBatchMock = vi.fn();
const deleteProvidersBatchMock = vi.fn();

const publishProviderCacheInvalidationMock = vi.fn();
const clearProviderStateMock = vi.fn();
const clearConfigCacheMock = vi.fn();
const resetCircuitMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  updateProvidersBatch: updateProvidersBatchMock,
  deleteProvidersBatch: deleteProvidersBatchMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishProviderCacheInvalidationMock,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearProviderState: clearProviderStateMock,
  clearConfigCache: clearConfigCacheMock,
  resetCircuit: resetCircuitMock,
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

describe("Provider Batch Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    updateProvidersBatchMock.mockResolvedValue(3);
    deleteProvidersBatchMock.mockResolvedValue(3);
    publishProviderCacheInvalidationMock.mockResolvedValue(undefined);
    clearProviderStateMock.mockReturnValue(undefined);
    clearConfigCacheMock.mockReturnValue(undefined);
    resetCircuitMock.mockReturnValue(undefined);
  });

  describe("batchUpdateProviders", () => {
    it("should require admin role", async () => {
      getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [1, 2, 3],
        updates: { is_enabled: true },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("无权限执行此操作");
      expect(updateProvidersBatchMock).not.toHaveBeenCalled();
      expect(publishProviderCacheInvalidationMock).not.toHaveBeenCalled();
    });

    it("should reject empty providerIds", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [],
        updates: { is_enabled: true },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("请选择要更新的供应商");
      expect(updateProvidersBatchMock).not.toHaveBeenCalled();
    });

    it("should enforce max batch size 500", async () => {
      const largeIds = Array.from({ length: 501 }, (_, i) => i + 1);

      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: largeIds,
        updates: { is_enabled: true },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("单次批量操作最多支持 500 个供应商");
      expect(updateProvidersBatchMock).not.toHaveBeenCalled();
    });

    it("should update specified fields for selected providers", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [10, 20, 30],
        updates: {
          is_enabled: false,
          priority: 5,
          weight: 2,
          cost_multiplier: 1.5,
          group_tag: "batch-test",
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.updatedCount).toBe(3);
      expect(updateProvidersBatchMock).toHaveBeenCalledWith([10, 20, 30], {
        isEnabled: false,
        priority: 5,
        weight: 2,
        costMultiplier: "1.5",
        groupTag: "batch-test",
      });
    });

    it("should invalidate cache after update", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      await batchUpdateProviders({
        providerIds: [1, 2],
        updates: { is_enabled: true },
      });

      expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(1);
    });

    it("should not fail when cache invalidation throws", async () => {
      publishProviderCacheInvalidationMock.mockRejectedValueOnce(new Error("cache error"));

      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [1, 2],
        updates: { priority: 10 },
      });

      expect(result.ok).toBe(true);
      expect(updateProvidersBatchMock).toHaveBeenCalledTimes(1);
      expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(1);
    });

    it("should handle partial updates with null group_tag", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [5],
        updates: { group_tag: null },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(updateProvidersBatchMock).toHaveBeenCalledWith([5], {
        groupTag: null,
      });
    });

    it("should handle partial updates with only one field", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [1, 2],
        updates: { priority: 0 },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(updateProvidersBatchMock).toHaveBeenCalledWith([1, 2], {
        priority: 0,
      });
    });

    it("should convert cost_multiplier to string", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      await batchUpdateProviders({
        providerIds: [1],
        updates: { cost_multiplier: 2.5 },
      });

      expect(updateProvidersBatchMock).toHaveBeenCalledWith([1], {
        costMultiplier: "2.5",
      });
    });

    it("should handle repository errors gracefully", async () => {
      updateProvidersBatchMock.mockRejectedValueOnce(new Error("DB error"));

      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [1, 2],
        updates: { is_enabled: true },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("DB error");
    });

    it("should reject when no updates provided", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");
      const result = await batchUpdateProviders({
        providerIds: [1, 2],
        updates: {},
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("请指定要更新的字段");
      expect(updateProvidersBatchMock).not.toHaveBeenCalled();
    });
  });

  describe("batchDeleteProviders", () => {
    it("should require admin role", async () => {
      getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

      const { batchDeleteProviders } = await import("@/actions/providers");
      const result = await batchDeleteProviders({ providerIds: [1, 2] });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("无权限执行此操作");
      expect(deleteProvidersBatchMock).not.toHaveBeenCalled();
    });

    it("should reject empty providerIds", async () => {
      const { batchDeleteProviders } = await import("@/actions/providers");
      const result = await batchDeleteProviders({ providerIds: [] });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("请选择要删除的供应商");
      expect(deleteProvidersBatchMock).not.toHaveBeenCalled();
    });

    it("should enforce max batch size 500", async () => {
      const largeIds = Array.from({ length: 501 }, (_, i) => i + 1);

      const { batchDeleteProviders } = await import("@/actions/providers");
      const result = await batchDeleteProviders({ providerIds: largeIds });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("单次批量操作最多支持 500 个供应商");
      expect(deleteProvidersBatchMock).not.toHaveBeenCalled();
    });

    it("should soft delete providers", async () => {
      const { batchDeleteProviders } = await import("@/actions/providers");
      const result = await batchDeleteProviders({ providerIds: [10, 20, 30] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.deletedCount).toBe(3);
      expect(deleteProvidersBatchMock).toHaveBeenCalledWith([10, 20, 30]);
    });

    it("should clear circuit breaker state for each deleted provider", async () => {
      const { batchDeleteProviders } = await import("@/actions/providers");
      await batchDeleteProviders({ providerIds: [1, 2, 3] });

      expect(clearProviderStateMock).toHaveBeenCalledTimes(3);
      expect(clearProviderStateMock).toHaveBeenNthCalledWith(1, 1);
      expect(clearProviderStateMock).toHaveBeenNthCalledWith(2, 2);
      expect(clearProviderStateMock).toHaveBeenNthCalledWith(3, 3);

      expect(clearConfigCacheMock).toHaveBeenCalledTimes(3);
      expect(clearConfigCacheMock).toHaveBeenNthCalledWith(1, 1);
      expect(clearConfigCacheMock).toHaveBeenNthCalledWith(2, 2);
      expect(clearConfigCacheMock).toHaveBeenNthCalledWith(3, 3);
    });

    it("should invalidate cache after deletion", async () => {
      const { batchDeleteProviders } = await import("@/actions/providers");
      await batchDeleteProviders({ providerIds: [1, 2] });

      expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(1);
    });

    it("should not fail when cache invalidation throws", async () => {
      publishProviderCacheInvalidationMock.mockRejectedValueOnce(new Error("cache error"));

      const { batchDeleteProviders } = await import("@/actions/providers");
      const result = await batchDeleteProviders({ providerIds: [1, 2] });

      expect(result.ok).toBe(true);
      expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(1);
    });

    it("should handle repository errors gracefully", async () => {
      deleteProvidersBatchMock.mockRejectedValueOnce(new Error("DB error"));

      const { batchDeleteProviders } = await import("@/actions/providers");
      const result = await batchDeleteProviders({ providerIds: [1, 2] });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("DB error");
    });
  });

  describe("batchResetProviderCircuits", () => {
    it("should require admin role", async () => {
      getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: [1, 2] });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("无权限执行此操作");
      expect(resetCircuitMock).not.toHaveBeenCalled();
    });

    it("should reject empty providerIds", async () => {
      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: [] });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("请选择要重置的供应商");
      expect(resetCircuitMock).not.toHaveBeenCalled();
    });

    it("should enforce max batch size 500", async () => {
      const largeIds = Array.from({ length: 501 }, (_, i) => i + 1);

      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: largeIds });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("单次批量操作最多支持 500 个供应商");
      expect(resetCircuitMock).not.toHaveBeenCalled();
    });

    it("should reset circuit state for all providers", async () => {
      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: [10, 20, 30] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.resetCount).toBe(3);
      expect(resetCircuitMock).toHaveBeenCalledTimes(3);
      expect(resetCircuitMock).toHaveBeenNthCalledWith(1, 10);
      expect(resetCircuitMock).toHaveBeenNthCalledWith(2, 20);
      expect(resetCircuitMock).toHaveBeenNthCalledWith(3, 30);
    });

    it("should clear config cache for each provider", async () => {
      const { batchResetProviderCircuits } = await import("@/actions/providers");
      await batchResetProviderCircuits({ providerIds: [1, 2] });

      expect(clearConfigCacheMock).toHaveBeenCalledTimes(2);
      expect(clearConfigCacheMock).toHaveBeenNthCalledWith(1, 1);
      expect(clearConfigCacheMock).toHaveBeenNthCalledWith(2, 2);
    });

    it("should handle single provider", async () => {
      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: [1] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.resetCount).toBe(1);
      expect(resetCircuitMock).toHaveBeenCalledWith(1);
    });

    it("should handle large batch within limit", async () => {
      const ids = Array.from({ length: 500 }, (_, i) => i + 1);

      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: ids });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.resetCount).toBe(500);
      expect(resetCircuitMock).toHaveBeenCalledTimes(500);
    });

    it("should handle errors during reset", async () => {
      resetCircuitMock.mockImplementationOnce(() => {
        throw new Error("Reset failed");
      });

      const { batchResetProviderCircuits } = await import("@/actions/providers");
      const result = await batchResetProviderCircuits({ providerIds: [1] });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toBe("Reset failed");
    });
  });

  describe("Batch Operations Integration", () => {
    it("should handle multiple operations in sequence", async () => {
      const { batchUpdateProviders, batchResetProviderCircuits, batchDeleteProviders } =
        await import("@/actions/providers");

      const updateResult = await batchUpdateProviders({
        providerIds: [1, 2],
        updates: { is_enabled: false },
      });
      expect(updateResult.ok).toBe(true);

      const resetResult = await batchResetProviderCircuits({ providerIds: [1, 2] });
      expect(resetResult.ok).toBe(true);

      const deleteResult = await batchDeleteProviders({ providerIds: [1, 2] });
      expect(deleteResult.ok).toBe(true);

      expect(updateProvidersBatchMock).toHaveBeenCalledTimes(1);
      expect(resetCircuitMock).toHaveBeenCalledTimes(2);
      expect(deleteProvidersBatchMock).toHaveBeenCalledTimes(1);
      expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(2);
    });

    it("should handle overlapping provider sets", async () => {
      const { batchUpdateProviders } = await import("@/actions/providers");

      await batchUpdateProviders({
        providerIds: [1, 2, 3],
        updates: { priority: 0 },
      });
      await batchUpdateProviders({
        providerIds: [2, 3, 4],
        updates: { priority: 1 },
      });

      expect(updateProvidersBatchMock).toHaveBeenCalledTimes(2);
      expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(2);
    });

    it("should maintain operation isolation on errors", async () => {
      updateProvidersBatchMock.mockRejectedValueOnce(new Error("update error"));

      const { batchUpdateProviders, batchResetProviderCircuits } = await import(
        "@/actions/providers"
      );

      const updateResult = await batchUpdateProviders({
        providerIds: [1],
        updates: { is_enabled: true },
      });
      expect(updateResult.ok).toBe(false);

      const resetResult = await batchResetProviderCircuits({ providerIds: [1] });
      expect(resetResult.ok).toBe(true);
    });
  });
});
