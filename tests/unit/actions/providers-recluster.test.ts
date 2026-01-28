import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const findProviderVendorByIdMock = vi.fn();
const getOrCreateProviderVendorIdFromUrlsMock = vi.fn();
const computeVendorKeyMock = vi.fn();
const backfillProviderEndpointsFromProvidersMock = vi.fn();
const tryDeleteProviderVendorIfEmptyMock = vi.fn();
const publishProviderCacheInvalidationMock = vi.fn();
const dbMock = {
  transaction: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn(async () => []),
  findAllProvidersFresh: findAllProvidersFreshMock,
  findProviderById: vi.fn(async () => null),
}));

vi.mock("@/repository/provider-endpoints", () => ({
  computeVendorKey: computeVendorKeyMock,
  findProviderVendorById: findProviderVendorByIdMock,
  getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
  backfillProviderEndpointsFromProviders: backfillProviderEndpointsFromProvidersMock,
  tryDeleteProviderVendorIfEmpty: tryDeleteProviderVendorIfEmptyMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishProviderCacheInvalidationMock,
}));

vi.mock("@/drizzle/db", () => ({
  db: dbMock,
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

describe("reclusterProviderVendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("permission checks", () => {
    it("returns error when not logged in", async () => {
      getSessionMock.mockResolvedValue(null);

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error when user is not admin", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("allows admin users", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([]);

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
    });
  });

  describe("preview mode (confirm=false)", () => {
    it("returns empty changes when no providers", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([]);

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.changes).toEqual([]);
        expect(result.data.preview.providersMoved).toBe(0);
      }
    });

    it("detects providers that need vendor change", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
        {
          id: 2,
          name: "Provider 2",
          url: "http://192.168.1.1:9090/v1/messages",
          websiteUrl: null,
          providerVendorId: 1, // Same vendor but different port - should change
        },
      ]);

      // Current vendor has domain "192.168.1.1" (old behavior)
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });

      // New vendor keys include port
      computeVendorKeyMock
        .mockReturnValueOnce("192.168.1.1:8080")
        .mockReturnValueOnce("192.168.1.1:9090");

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.preview.providersMoved).toBe(2);
        expect(result.data.changes.length).toBe(2);
      }
    });

    it("does not modify database in preview mode", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });
      computeVendorKeyMock.mockResolvedValue("192.168.1.1:8080");

      const { reclusterProviderVendors } = await import("@/actions/providers");
      await reclusterProviderVendors({ confirm: false });

      expect(dbMock.transaction).not.toHaveBeenCalled();
      expect(publishProviderCacheInvalidationMock).not.toHaveBeenCalled();
    });

    it("skips providers with invalid URLs", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Invalid Provider",
          url: "://invalid",
          websiteUrl: null,
          providerVendorId: null,
        },
      ]);
      computeVendorKeyMock.mockResolvedValue(null);

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.preview.skippedInvalidUrl).toBe(1);
        expect(result.data.preview.providersMoved).toBe(0);
      }
    });
  });

  describe("apply mode (confirm=true)", () => {
    it("executes database updates in transaction", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });
      computeVendorKeyMock.mockResolvedValue("192.168.1.1:8080");
      getOrCreateProviderVendorIdFromUrlsMock.mockResolvedValue(2);
      backfillProviderEndpointsFromProvidersMock.mockResolvedValue({});
      tryDeleteProviderVendorIfEmptyMock.mockResolvedValue(true);
      dbMock.transaction.mockImplementation(async (fn) => {
        return fn({
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue({}),
            }),
          }),
        });
      });

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(true);
      }
      expect(dbMock.transaction).toHaveBeenCalled();
    });

    it("publishes cache invalidation after apply", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });
      computeVendorKeyMock.mockResolvedValue("192.168.1.1:8080");
      getOrCreateProviderVendorIdFromUrlsMock.mockResolvedValue(2);
      backfillProviderEndpointsFromProvidersMock.mockResolvedValue({});
      tryDeleteProviderVendorIfEmptyMock.mockResolvedValue(true);
      dbMock.transaction.mockImplementation(async (fn) => {
        return fn({
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue({}),
            }),
          }),
        });
      });

      const { reclusterProviderVendors } = await import("@/actions/providers");
      await reclusterProviderVendors({ confirm: true });

      expect(publishProviderCacheInvalidationMock).toHaveBeenCalled();
    });

    it("does not apply when no changes needed", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      // Vendor already has correct domain
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1:8080",
      });
      computeVendorKeyMock.mockResolvedValue("192.168.1.1:8080");

      const { reclusterProviderVendors } = await import("@/actions/providers");
      const result = await reclusterProviderVendors({ confirm: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(true);
        expect(result.data.preview.providersMoved).toBe(0);
      }
      expect(dbMock.transaction).not.toHaveBeenCalled();
    });
  });
});
