import type { AuthSession } from "@/lib/auth";
import { DASHBOARD_COMPAT_HEADER } from "@/lib/api/v1/_shared/constants";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getProviderVendorsMock = vi.hoisted(() => vi.fn());
const getDashboardProviderVendorsMock = vi.hoisted(() => vi.fn());
const getProviderVendorByIdMock = vi.hoisted(() => vi.fn());
const getProviderEndpointsMock = vi.hoisted(() => vi.fn());
const getDashboardProviderEndpointsMock = vi.hoisted(() => vi.fn());
const getProviderEndpointsByVendorMock = vi.hoisted(() => vi.fn());
const addProviderEndpointMock = vi.hoisted(() => vi.fn());
const editProviderEndpointMock = vi.hoisted(() => vi.fn());
const removeProviderEndpointMock = vi.hoisted(() => vi.fn());
const probeProviderEndpointMock = vi.hoisted(() => vi.fn());
const getProviderEndpointProbeLogsMock = vi.hoisted(() => vi.fn());
const batchGetProviderEndpointProbeLogsMock = vi.hoisted(() => vi.fn());
const batchGetVendorTypeEndpointStatsMock = vi.hoisted(() => vi.fn());
const getEndpointCircuitInfoMock = vi.hoisted(() => vi.fn());
const batchGetEndpointCircuitInfoMock = vi.hoisted(() => vi.fn());
const resetEndpointCircuitMock = vi.hoisted(() => vi.fn());
const getVendorTypeCircuitInfoMock = vi.hoisted(() => vi.fn());
const setVendorTypeCircuitManualOpenMock = vi.hoisted(() => vi.fn());
const resetVendorTypeCircuitMock = vi.hoisted(() => vi.fn());
const editProviderVendorMock = vi.hoisted(() => vi.fn());
const removeProviderVendorMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const findProviderEndpointByIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/provider-endpoints", () => ({
  getProviderVendors: getProviderVendorsMock,
  getDashboardProviderVendors: getDashboardProviderVendorsMock,
  getProviderVendorById: getProviderVendorByIdMock,
  getProviderEndpoints: getProviderEndpointsMock,
  getDashboardProviderEndpoints: getDashboardProviderEndpointsMock,
  getProviderEndpointsByVendor: getProviderEndpointsByVendorMock,
  addProviderEndpoint: addProviderEndpointMock,
  editProviderEndpoint: editProviderEndpointMock,
  removeProviderEndpoint: removeProviderEndpointMock,
  probeProviderEndpoint: probeProviderEndpointMock,
  getProviderEndpointProbeLogs: getProviderEndpointProbeLogsMock,
  batchGetProviderEndpointProbeLogs: batchGetProviderEndpointProbeLogsMock,
  batchGetVendorTypeEndpointStats: batchGetVendorTypeEndpointStatsMock,
  getEndpointCircuitInfo: getEndpointCircuitInfoMock,
  batchGetEndpointCircuitInfo: batchGetEndpointCircuitInfoMock,
  resetEndpointCircuit: resetEndpointCircuitMock,
  getVendorTypeCircuitInfo: getVendorTypeCircuitInfoMock,
  setVendorTypeCircuitManualOpen: setVendorTypeCircuitManualOpenMock,
  resetVendorTypeCircuit: resetVendorTypeCircuitMock,
  editProviderVendor: editProviderVendorMock,
  removeProviderVendor: removeProviderVendorMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/repository/provider-endpoints", () => ({
  findProviderEndpointById: findProviderEndpointByIdMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };
const dashboardCompatHeaders = { ...headers, [DASHBOARD_COMPAT_HEADER]: "1" };

function vendor(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "anthropic",
    displayName: "Anthropic",
    websiteUrl: "https://web-user:web-pass@anthropic.com",
    faviconUrl: null,
    providerTypes: ["claude"],
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

function endpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    vendorId: 1,
    providerType: "claude",
    url: "https://endpoint-user:endpoint-pass@api.anthropic.com",
    label: "primary",
    sortOrder: 0,
    isEnabled: true,
    deletedAt: null,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 provider endpoint REST endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getProviderVendorsMock.mockResolvedValue([vendor()]);
    getDashboardProviderVendorsMock.mockResolvedValue([
      vendor(),
      vendor({ id: 2, name: "legacy", providerTypes: ["claude-auth", "gemini-cli"] }),
    ]);
    getProviderVendorByIdMock.mockResolvedValue(vendor());
    getProviderEndpointsMock.mockResolvedValue([endpoint()]);
    getDashboardProviderEndpointsMock.mockResolvedValue([endpoint({ label: "dashboard" })]);
    getProviderEndpointsByVendorMock.mockResolvedValue([
      endpoint(),
      endpoint({ id: 12, providerType: "claude-auth", label: "legacy" }),
      endpoint({ id: 13, providerType: "gemini-cli", label: "legacy-gemini" }),
    ]);
    findProviderEndpointByIdMock.mockResolvedValue(endpoint());
    addProviderEndpointMock.mockResolvedValue({
      ok: true,
      data: { endpoint: endpoint({ id: 11 }) },
    });
    editProviderEndpointMock.mockResolvedValue({
      ok: true,
      data: { endpoint: endpoint({ label: "updated" }) },
    });
    removeProviderEndpointMock.mockResolvedValue({ ok: true });
    probeProviderEndpointMock.mockResolvedValue({
      ok: true,
      data: {
        endpoint: endpoint(),
        result: {
          ok: true,
          method: "HEAD",
          statusCode: 200,
          latencyMs: 42,
          errorType: null,
          errorMessage: null,
        },
      },
    });
    getProviderEndpointProbeLogsMock.mockResolvedValue({
      ok: true,
      data: { endpointId: 10, logs: [{ id: 1, ok: true }] },
    });
    batchGetProviderEndpointProbeLogsMock.mockResolvedValue({
      ok: true,
      data: [{ endpointId: 10, logs: [] }],
    });
    batchGetVendorTypeEndpointStatsMock.mockResolvedValue({
      ok: true,
      data: [{ vendorId: 1, providerType: "claude", total: 1, enabled: 1 }],
    });
    getEndpointCircuitInfoMock.mockResolvedValue({
      ok: true,
      data: {
        endpointId: 10,
        health: {
          failureCount: 0,
          lastFailureTime: null,
          circuitState: "closed",
          circuitOpenUntil: null,
          halfOpenSuccessCount: 0,
        },
        config: {
          failureThreshold: 5,
          openDuration: 60_000,
          halfOpenSuccessThreshold: 1,
        },
      },
    });
    batchGetEndpointCircuitInfoMock.mockResolvedValue({
      ok: true,
      data: [{ endpointId: 10, circuitState: "closed", failureCount: 0, circuitOpenUntil: null }],
    });
    resetEndpointCircuitMock.mockResolvedValue({ ok: true });
    getVendorTypeCircuitInfoMock.mockResolvedValue({
      ok: true,
      data: {
        vendorId: 1,
        providerType: "claude",
        circuitState: "closed",
        circuitOpenUntil: null,
        lastFailureTime: null,
        manualOpen: false,
      },
    });
    setVendorTypeCircuitManualOpenMock.mockResolvedValue({ ok: true });
    resetVendorTypeCircuitMock.mockResolvedValue({ ok: true });
    editProviderVendorMock.mockResolvedValue({
      ok: true,
      data: { vendor: vendor({ displayName: "A" }) },
    });
    removeProviderVendorMock.mockResolvedValue({ ok: true });
  });

  test("lists provider vendors and filters hidden dashboard provider types", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors",
      headers,
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({ items: [{ id: 1, providerTypes: ["claude"] }] });

    const dashboard = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors?dashboard=true",
      headers,
    });
    expect(dashboard.response.status).toBe(200);
    expect(getDashboardProviderVendorsMock).toHaveBeenCalled();
    expect(JSON.stringify(dashboard.json)).not.toContain("claude-auth");
    expect(JSON.stringify(dashboard.json)).not.toContain("gemini-cli");
    expect(JSON.stringify(dashboard.json)).not.toContain("web-pass");
    expect(JSON.stringify(dashboard.json)).toContain("REDACTED:REDACTED");
  });

  test("keeps hidden provider endpoint types for dashboard compatibility requests", async () => {
    const vendors = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors?dashboard=true",
      headers: dashboardCompatHeaders,
    });
    expect(vendors.response.status).toBe(200);
    expect(JSON.stringify(vendors.json)).toContain("claude-auth");
    expect(JSON.stringify(vendors.json)).toContain("gemini-cli");

    const endpoints = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/endpoints?dashboard=true",
      headers: dashboardCompatHeaders,
    });
    expect(endpoints.response.status).toBe(200);
    expect(endpoints.json).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 12, providerType: "claude-auth", label: "legacy" }),
      ]),
    });

    const filteredEndpoints = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/endpoints?providerType=gemini-cli",
      headers: dashboardCompatHeaders,
    });
    expect(filteredEndpoints.response.status).toBe(200);
    expect(getProviderEndpointsMock).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "gemini-cli",
    });

    const stats = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-vendors/endpoint-stats:batch",
      headers: dashboardCompatHeaders,
      body: { vendorIds: [1], providerType: "claude-auth" },
    });
    expect(stats.response.status).toBe(200);
    expect(batchGetVendorTypeEndpointStatsMock).toHaveBeenCalledWith({
      vendorIds: [1],
      providerType: "claude-auth",
    });
  });

  test("filters hidden vendor detail provider types unless dashboard compatibility is verified", async () => {
    getProviderVendorByIdMock.mockResolvedValueOnce(
      vendor({ providerTypes: ["claude", "claude-auth", "gemini-cli"] })
    );

    const visible = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1",
      headers,
    });

    expect(visible.response.status).toBe(200);
    expect(visible.json).toMatchObject({ providerTypes: ["claude"] });
    expect(JSON.stringify(visible.json)).not.toContain("claude-auth");
    expect(JSON.stringify(visible.json)).not.toContain("gemini-cli");

    getProviderVendorByIdMock.mockResolvedValueOnce(
      vendor({ providerTypes: ["claude", "claude-auth", "gemini-cli"] })
    );

    const compat = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1",
      headers: dashboardCompatHeaders,
    });

    expect(compat.response.status).toBe(200);
    expect(compat.json).toMatchObject({
      providerTypes: ["claude", "claude-auth", "gemini-cli"],
    });
  });

  test("rejects dashboard compatibility headers without an admin session", async () => {
    validateAuthTokenMock.mockResolvedValueOnce({
      ...adminSession,
      user: { ...adminSession.user, role: "user" },
    } as AuthSession);

    const response = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/endpoints?providerType=gemini-cli",
      headers: dashboardCompatHeaders,
    });

    expect(response.response.status).toBe(403);
    expect(response.json).toMatchObject({ errorCode: "auth.forbidden" });
    expect(getProviderEndpointsMock).not.toHaveBeenCalled();
  });

  test("reads, updates, and deletes provider vendors", async () => {
    const detail = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1",
      headers,
    });
    expect(detail.response.status).toBe(200);
    expect(getProviderVendorByIdMock).toHaveBeenCalledWith(1);
    expect(JSON.stringify(detail.json)).not.toContain("web-pass");
    expect(detail.json).toMatchObject({
      websiteUrl: "https://REDACTED:REDACTED@anthropic.com/",
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/provider-vendors/1",
      headers,
      body: { displayName: "A", websiteUrl: "https://example.com" },
    });
    expect(updated.response.status).toBe(200);
    expect(editProviderVendorMock).toHaveBeenCalledWith({
      vendorId: 1,
      displayName: "A",
      websiteUrl: "https://example.com",
    });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/provider-vendors/1",
      headers,
    });
    expect(deleted.response.status).toBe(204);
    expect(removeProviderVendorMock).toHaveBeenCalledWith({ vendorId: 1 });
  });

  test("lists, creates, updates, and deletes provider endpoints", async () => {
    const byVendor = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/endpoints",
      headers,
    });
    expect(byVendor.response.status).toBe(200);
    expect(getProviderEndpointsByVendorMock).toHaveBeenCalledWith({ vendorId: 1 });
    expect(JSON.stringify(byVendor.json)).not.toContain("claude-auth");
    expect(JSON.stringify(byVendor.json)).not.toContain("gemini-cli");
    expect(JSON.stringify(byVendor.json)).not.toContain("endpoint-pass");
    expect(JSON.stringify(byVendor.json)).toContain("REDACTED:REDACTED");

    const filtered = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/endpoints?providerType=claude&dashboard=true",
      headers,
    });
    expect(filtered.response.status).toBe(200);
    expect(getDashboardProviderEndpointsMock).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-vendors/1/endpoints",
      headers,
      body: {
        providerType: "claude",
        url: "https://api.example.com",
        label: "new",
        sortOrder: 1,
        isEnabled: true,
      },
    });
    expect(created.response.status).toBe(201);
    expect(JSON.stringify(created.json)).not.toContain("endpoint-pass");
    expect(created.json).toMatchObject({
      endpoint: { url: "https://REDACTED:REDACTED@api.anthropic.com/" },
    });
    expect(addProviderEndpointMock).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
      url: "https://api.example.com",
      label: "new",
      sortOrder: 1,
      isEnabled: true,
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/provider-endpoints/10",
      headers,
      body: { label: "updated" },
    });
    expect(updated.response.status).toBe(200);
    expect(JSON.stringify(updated.json)).not.toContain("endpoint-pass");
    expect(updated.json).toMatchObject({
      endpoint: { url: "https://REDACTED:REDACTED@api.anthropic.com/" },
    });
    expect(editProviderEndpointMock).toHaveBeenCalledWith({ endpointId: 10, label: "updated" });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/provider-endpoints/10",
      headers,
    });
    expect(deleted.response.status).toBe(204);
    expect(removeProviderEndpointMock).toHaveBeenCalledWith({ endpointId: 10 });
  });

  test("probes endpoints and reads probe logs", async () => {
    const probe = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-endpoints/10:probe",
      headers,
      body: { timeoutMs: 5000 },
    });
    expect(probe.response.status).toBe(200);
    expect(JSON.stringify(probe.json)).not.toContain("endpoint-pass");
    expect(probe.json).toMatchObject({
      endpoint: { url: "https://REDACTED:REDACTED@api.anthropic.com/" },
    });
    expect(probeProviderEndpointMock).toHaveBeenCalledWith({ endpointId: 10, timeoutMs: 5000 });

    const logs = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-endpoints/10/probe-logs?limit=5&offset=2",
      headers,
    });
    expect(logs.response.status).toBe(200);
    expect(getProviderEndpointProbeLogsMock).toHaveBeenCalledWith({
      endpointId: 10,
      limit: 5,
      offset: 2,
    });

    const batch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-endpoints/probe-logs:batch",
      headers,
      body: { endpointIds: [10], limit: 2 },
    });
    expect(batch.response.status).toBe(200);
    expect(batchGetProviderEndpointProbeLogsMock).toHaveBeenCalledWith({
      endpointIds: [10],
      limit: 2,
    });
  });

  test("reads and mutates endpoint and vendor circuit state", async () => {
    const endpointCircuit = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-endpoints/10/circuit",
      headers,
    });
    expect(endpointCircuit.response.status).toBe(200);
    expect(getEndpointCircuitInfoMock).toHaveBeenCalledWith({ endpointId: 10 });

    const batchEndpointCircuit = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-endpoints/circuits:batch",
      headers,
      body: { endpointIds: [10] },
    });
    expect(batchEndpointCircuit.response.status).toBe(200);
    expect(batchGetEndpointCircuitInfoMock).toHaveBeenCalledWith({ endpointIds: [10] });

    const resetEndpoint = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-endpoints/10/circuit:reset",
      headers,
    });
    expect(resetEndpoint.response.status).toBe(204);
    expect(resetEndpointCircuitMock).toHaveBeenCalledWith({ endpointId: 10 });

    const vendorCircuit = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/circuit?providerType=claude",
      headers,
    });
    expect(vendorCircuit.response.status).toBe(200);
    expect(getVendorTypeCircuitInfoMock).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });

    const manualOpen = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-vendors/1/circuit:setManualOpen",
      headers,
      body: { providerType: "claude", manualOpen: true },
    });
    expect(manualOpen.response.status).toBe(204);
    expect(setVendorTypeCircuitManualOpenMock).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
      manualOpen: true,
    });

    const resetVendor = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-vendors/1/circuit:reset",
      headers,
      body: { providerType: "claude" },
    });
    expect(resetVendor.response.status).toBe(204);
    expect(resetVendorTypeCircuitMock).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });
  });

  test("rejects hidden provider types before actions run", async () => {
    const invalidList = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/1/endpoints?providerType=gemini-cli",
      headers,
    });
    expect(invalidList.response.status).toBe(400);
    expect(getProviderEndpointsMock).not.toHaveBeenCalled();

    const invalidCreate = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-vendors/1/endpoints",
      headers,
      body: { providerType: "claude-auth", url: "https://legacy.example.com" },
    });
    expect(invalidCreate.response.status).toBe(400);
    expect(addProviderEndpointMock).not.toHaveBeenCalled();
  });

  test("hides deprecated endpoint ids before direct actions run", async () => {
    findProviderEndpointByIdMock.mockResolvedValue(endpoint({ providerType: "claude-auth" }));

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/provider-endpoints/10",
      headers,
      body: { label: "updated" },
    });
    expect(updated.response.status).toBe(404);
    expect(editProviderEndpointMock).not.toHaveBeenCalled();

    const batch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-endpoints/circuits:batch",
      headers,
      body: { endpointIds: [10] },
    });
    expect(batch.response.status).toBe(404);
    expect(batchGetEndpointCircuitInfoMock).not.toHaveBeenCalled();
  });

  test("maps action failures to problem+json statuses", async () => {
    getProviderVendorByIdMock.mockResolvedValueOnce(null);
    const missingVendor = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-vendors/404",
      headers,
    });
    expect(missingVendor.response.status).toBe(404);
    expect(missingVendor.json).toMatchObject({ errorCode: "provider_vendor.not_found" });

    editProviderEndpointMock.mockResolvedValueOnce({
      ok: false,
      error: "端点 URL 与其他端点冲突",
      errorCode: "CONFLICT",
    });
    const conflict = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/provider-endpoints/10",
      headers,
      body: { label: "updated" },
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.response.headers.get("content-type")).toContain("application/problem+json");

    removeProviderEndpointMock.mockResolvedValueOnce({
      ok: false,
      error: "端点仍被启用供应商引用",
      errorCode: "ENDPOINT_REFERENCED_BY_ENABLED_PROVIDERS",
    });
    const deleteConflict = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/provider-endpoints/10",
      headers,
    });
    expect(deleteConflict.response.status).toBe(409);
    expect(deleteConflict.json).toMatchObject({
      errorCode: "ENDPOINT_REFERENCED_BY_ENABLED_PROVIDERS",
    });
  });

  test("gets batch vendor endpoint stats and documents REST paths without legacy types", async () => {
    const stats = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-vendors/endpoint-stats:batch",
      headers,
      body: { vendorIds: [1], providerType: "claude" },
    });
    expect(stats.response.status).toBe(200);
    expect(batchGetVendorTypeEndpointStatsMock).toHaveBeenCalledWith({
      vendorIds: [1],
      providerType: "claude",
    });

    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors");
    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors/{vendorId}");
    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors/{vendorId}/endpoints");
    expect(doc.paths).toHaveProperty("/api/v1/provider-endpoints/{endpointId}:probe");
    expect(doc.paths).toHaveProperty("/api/v1/provider-endpoints/{endpointId}/probe-logs");
    expect(doc.paths).toHaveProperty("/api/v1/provider-endpoints/probe-logs:batch");
    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors/endpoint-stats:batch");
    expect(doc.paths).toHaveProperty("/api/v1/provider-endpoints/{endpointId}/circuit");
    expect(doc.paths).toHaveProperty("/api/v1/provider-endpoints/circuits:batch");
    expect(doc.paths).toHaveProperty("/api/v1/provider-endpoints/{endpointId}/circuit:reset");
    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors/{vendorId}/circuit");
    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors/{vendorId}/circuit:setManualOpen");
    expect(doc.paths).toHaveProperty("/api/v1/provider-vendors/{vendorId}/circuit:reset");
    expect(JSON.stringify(doc)).not.toContain("claude-auth");
    expect(JSON.stringify(doc)).not.toContain("gemini-cli");
  });
});
