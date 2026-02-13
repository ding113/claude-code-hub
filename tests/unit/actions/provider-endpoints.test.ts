import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

const updateProviderVendorMock = vi.fn();
const deleteProviderVendorMock = vi.fn();
const publishProviderCacheInvalidationMock = vi.fn();

const findProviderEndpointByIdMock = vi.fn();
const softDeleteProviderEndpointMock = vi.fn();
const tryDeleteProviderVendorIfEmptyMock = vi.fn();
const updateProviderEndpointMock = vi.fn();
const findProviderEndpointProbeLogsBatchMock = vi.fn();
const findVendorTypeEndpointStatsBatchMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishProviderCacheInvalidationMock,
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

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  getAllEndpointHealthStatusAsync: vi.fn(async () => ({})),
  getEndpointHealthInfo: vi.fn(async () => ({ health: {}, config: {} })),
  resetEndpointCircuit: vi.fn(async () => {}),
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  getVendorTypeCircuitInfo: vi.fn(async () => ({
    vendorId: 1,
    providerType: "claude",
    circuitState: "closed",
    circuitOpenUntil: null,
    lastFailureTime: null,
    manualOpen: false,
  })),
  resetVendorTypeCircuit: vi.fn(async () => {}),
  setVendorTypeCircuitManualOpen: vi.fn(async () => {}),
}));

vi.mock("@/lib/provider-endpoints/probe", () => ({
  probeProviderEndpointAndRecord: vi.fn(async () => null),
}));

vi.mock("@/repository/provider-endpoints-batch", () => ({
  findProviderEndpointProbeLogsBatch: findProviderEndpointProbeLogsBatchMock,
  findVendorTypeEndpointStatsBatch: findVendorTypeEndpointStatsBatchMock,
}));

vi.mock("@/repository", () => ({
  createProviderEndpoint: vi.fn(async () => ({})),
  deleteProviderVendor: deleteProviderVendorMock,
  findProviderEndpointById: findProviderEndpointByIdMock,
  findProviderEndpointProbeLogs: vi.fn(async () => []),
  findProviderEndpointsByVendorAndType: vi.fn(async () => []),
  findProviderVendorById: vi.fn(async () => null),
  findProviderVendors: vi.fn(async () => []),
  softDeleteProviderEndpoint: softDeleteProviderEndpointMock,
  tryDeleteProviderVendorIfEmpty: tryDeleteProviderVendorIfEmptyMock,
  updateProviderEndpoint: updateProviderEndpointMock,
  updateProviderVendor: updateProviderVendorMock,
}));

describe("provider-endpoints actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("editProviderVendor: requires admin", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "user" } });

    const { editProviderVendor } = await import("@/actions/provider-endpoints");
    const res = await editProviderVendor({ vendorId: 1, displayName: "x" });

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("PERMISSION_DENIED");
  });

  it("editProviderVendor: computes favicon", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    updateProviderVendorMock.mockResolvedValue({
      id: 1,
      websiteDomain: "example.com",
      displayName: "Example",
      websiteUrl: "https://example.com/path",
      faviconUrl: "https://www.google.com/s2/favicons?domain=example.com&sz=32",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { editProviderVendor } = await import("@/actions/provider-endpoints");
    const res = await editProviderVendor({
      vendorId: 1,
      displayName: "Example",
      websiteUrl: "https://example.com/path",
    });

    expect(res.ok).toBe(true);
    expect(updateProviderVendorMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        displayName: "Example",
        websiteUrl: "https://example.com/path",
        faviconUrl: "https://www.google.com/s2/favicons?domain=example.com&sz=32",
      })
    );
  });

  it("editProviderVendor: clearing websiteUrl clears faviconUrl", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    updateProviderVendorMock.mockResolvedValue({
      id: 1,
      websiteDomain: "example.com",
      displayName: null,
      websiteUrl: null,
      faviconUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { editProviderVendor } = await import("@/actions/provider-endpoints");
    const res = await editProviderVendor({
      vendorId: 1,
      websiteUrl: null,
    });

    expect(res.ok).toBe(true);
    expect(updateProviderVendorMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        websiteUrl: null,
        faviconUrl: null,
      })
    );
  });

  it("editProviderEndpoint: conflict maps to CONFLICT errorCode", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });
    updateProviderEndpointMock.mockRejectedValue(
      Object.assign(new Error("[ProviderEndpointEdit] endpoint conflict"), {
        code: "PROVIDER_ENDPOINT_CONFLICT",
      })
    );

    const { editProviderEndpoint } = await import("@/actions/provider-endpoints");
    const res = await editProviderEndpoint({
      endpointId: 42,
      url: "https://next.example.com/v1/messages",
    });

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CONFLICT");
    expect(res.error).not.toContain("duplicate key value");
  });

  it("editProviderEndpoint: success returns ok with endpoint payload", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    const endpoint = {
      id: 42,
      vendorId: 123,
      providerType: "claude" as const,
      url: "https://next.example.com/v1/messages",
      label: "primary",
      sortOrder: 7,
      isEnabled: false,
      lastProbedAt: null,
      lastProbeOk: null,
      lastProbeStatusCode: null,
      lastProbeLatencyMs: null,
      lastProbeErrorType: null,
      lastProbeErrorMessage: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: null,
    };

    updateProviderEndpointMock.mockResolvedValue(endpoint);

    const { editProviderEndpoint } = await import("@/actions/provider-endpoints");
    const res = await editProviderEndpoint({
      endpointId: 42,
      url: endpoint.url,
      label: endpoint.label,
      sortOrder: endpoint.sortOrder,
      isEnabled: endpoint.isEnabled,
    });

    expect(res.ok).toBe(true);
    expect(res.data?.endpoint).toEqual(endpoint);
    expect(updateProviderEndpointMock).toHaveBeenCalledWith(42, {
      url: endpoint.url,
      label: endpoint.label,
      sortOrder: endpoint.sortOrder,
      isEnabled: endpoint.isEnabled,
    });
  });

  it("removeProviderVendor: deletes vendor and publishes cache invalidation", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    deleteProviderVendorMock.mockResolvedValue(true);
    publishProviderCacheInvalidationMock.mockResolvedValue(undefined);

    const { removeProviderVendor } = await import("@/actions/provider-endpoints");
    const res = await removeProviderVendor({ vendorId: 1 });

    expect(res.ok).toBe(true);
    expect(deleteProviderVendorMock).toHaveBeenCalledWith(1);
    expect(publishProviderCacheInvalidationMock).toHaveBeenCalledTimes(1);
  });

  it("removeProviderVendor: still ok when cache invalidation fails", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    deleteProviderVendorMock.mockResolvedValue(true);
    publishProviderCacheInvalidationMock.mockRejectedValue(new Error("boom"));

    const { removeProviderVendor } = await import("@/actions/provider-endpoints");
    const res = await removeProviderVendor({ vendorId: 1 });

    expect(res.ok).toBe(true);
    expect(deleteProviderVendorMock).toHaveBeenCalledWith(1);
  });

  it("removeProviderEndpoint: triggers vendor cleanup after soft delete", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    findProviderEndpointByIdMock.mockResolvedValue({
      id: 99,
      vendorId: 123,
      providerType: "claude",
      url: "https://api.example.com",
      label: null,
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastProbeOk: null,
      lastProbeStatusCode: null,
      lastProbeLatencyMs: null,
      lastProbeErrorType: null,
      lastProbeErrorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    softDeleteProviderEndpointMock.mockResolvedValue(true);
    tryDeleteProviderVendorIfEmptyMock.mockResolvedValue(true);

    const { removeProviderEndpoint } = await import("@/actions/provider-endpoints");
    const res = await removeProviderEndpoint({ endpointId: 99 });

    expect(res.ok).toBe(true);
    expect(tryDeleteProviderVendorIfEmptyMock).toHaveBeenCalledWith(123);
  });

  describe("batchGetEndpointCircuitInfo", () => {
    it("returns circuit info for multiple endpoints", async () => {
      getSessionMock.mockResolvedValue({ user: { role: "admin" } });

      const { getAllEndpointHealthStatusAsync } = await import("@/lib/endpoint-circuit-breaker");
      vi.mocked(getAllEndpointHealthStatusAsync).mockResolvedValue({
        1: {
          failureCount: 0,
          lastFailureTime: null,
          circuitState: "closed",
          circuitOpenUntil: null,
          halfOpenSuccessCount: 0,
        },
        2: {
          failureCount: 5,
          lastFailureTime: Date.now(),
          circuitState: "open",
          circuitOpenUntil: Date.now() + 60000,
          halfOpenSuccessCount: 0,
        },
        3: {
          failureCount: 1,
          lastFailureTime: Date.now() - 1000,
          circuitState: "half-open",
          circuitOpenUntil: null,
          halfOpenSuccessCount: 0,
        },
      });

      const { batchGetEndpointCircuitInfo } = await import("@/actions/provider-endpoints");
      const res = await batchGetEndpointCircuitInfo({ endpointIds: [1, 2, 3] });

      expect(res.ok).toBe(true);
      expect(getAllEndpointHealthStatusAsync).toHaveBeenCalledWith([1, 2, 3], { forceRefresh: true });
      expect(res.data).toHaveLength(3);
      expect(res.data?.[0]).toEqual({
        endpointId: 1,
        circuitState: "closed",
        failureCount: 0,
        circuitOpenUntil: null,
      });
      expect(res.data?.[1]).toEqual({
        endpointId: 2,
        circuitState: "open",
        failureCount: 5,
        circuitOpenUntil: expect.any(Number),
      });
      expect(res.data?.[2]).toEqual({
        endpointId: 3,
        circuitState: "half-open",
        failureCount: 1,
        circuitOpenUntil: null,
      });
    });

    it("returns empty array for empty input", async () => {
      getSessionMock.mockResolvedValue({ user: { role: "admin" } });

      const { batchGetEndpointCircuitInfo } = await import("@/actions/provider-endpoints");
      const res = await batchGetEndpointCircuitInfo({ endpointIds: [] });

      expect(res.ok).toBe(true);
      expect(res.data).toEqual([]);
    });

    it("requires admin session", async () => {
      getSessionMock.mockResolvedValue({ user: { role: "user" } });

      const { batchGetEndpointCircuitInfo } = await import("@/actions/provider-endpoints");
      const res = await batchGetEndpointCircuitInfo({ endpointIds: [1, 2] });

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("PERMISSION_DENIED");
    });

    it("validates endpointIds are positive integers", async () => {
      getSessionMock.mockResolvedValue({ user: { role: "admin" } });

      const { batchGetEndpointCircuitInfo } = await import("@/actions/provider-endpoints");
      const res = await batchGetEndpointCircuitInfo({ endpointIds: [0, -1, 1] });

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("MIN_VALUE");
    });
  });
});
