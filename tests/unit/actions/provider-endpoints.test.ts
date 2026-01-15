import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

const updateProviderVendorMock = vi.fn();
const deleteProviderVendorMock = vi.fn();
const publishProviderCacheInvalidationMock = vi.fn();

const findProviderEndpointByIdMock = vi.fn();
const softDeleteProviderEndpointMock = vi.fn();
const tryDeleteProviderVendorIfEmptyMock = vi.fn();

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
  updateProviderEndpoint: vi.fn(async () => null),
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
});
