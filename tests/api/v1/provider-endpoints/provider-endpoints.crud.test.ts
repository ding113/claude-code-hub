/**
 * /api/v1/provider-vendors + /api/v1/provider-endpoints CRUD tests.
 */

import "../../../server-only.mock";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "true");
  vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
  vi.stubEnv("ADMIN_TOKEN", "admin-env-token-only-for-tests");
  const env = await import("@/lib/config/env.schema");
  env.resetEnvConfigForTests();
});

const RAW_VENDOR = {
  id: 10,
  websiteDomain: "anthropic.com",
  displayName: "Anthropic",
  websiteUrl: "https://anthropic.com",
  faviconUrl: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

const RAW_ENDPOINT = {
  id: 100,
  vendorId: 10,
  providerType: "claude" as const,
  url: "https://api.anthropic.com",
  label: "primary",
  sortOrder: 0,
  isEnabled: true,
  lastProbedAt: null,
  lastProbeOk: null,
  lastProbeStatusCode: null,
  lastProbeLatencyMs: null,
  lastProbeErrorType: null,
  lastProbeErrorMessage: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
  deletedAt: null,
};

const HIDDEN_ENDPOINT = {
  ...RAW_ENDPOINT,
  id: 101,
  providerType: "claude-auth" as const,
  url: "https://internal.anthropic.com",
};

vi.mock("@/actions/provider-endpoints", () => ({
  getProviderVendors: vi.fn(async () => [RAW_VENDOR]),
  getDashboardProviderVendors: vi.fn(async () => [{ ...RAW_VENDOR, providerTypes: ["claude"] }]),
  getProviderVendorById: vi.fn(async (id: number) => (id === 10 ? RAW_VENDOR : null)),
  getProviderEndpoints: vi.fn(async () => [RAW_ENDPOINT, HIDDEN_ENDPOINT]),
  getProviderEndpointsByVendor: vi.fn(async () => [RAW_ENDPOINT, HIDDEN_ENDPOINT]),
  addProviderEndpoint: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: {
      endpoint: {
        ...RAW_ENDPOINT,
        id: 200,
        url: input.url,
        providerType: input.providerType,
        label: input.label ?? null,
      },
    },
  })),
  editProviderEndpoint: vi.fn(async () => ({
    ok: true,
    data: { endpoint: { ...RAW_ENDPOINT, isEnabled: false } },
  })),
  removeProviderEndpoint: vi.fn(async () => ({ ok: true })),
  probeProviderEndpoint: vi.fn(async () => ({
    ok: true,
    data: {
      endpoint: RAW_ENDPOINT,
      result: {
        ok: true,
        method: "HEAD" as const,
        statusCode: 200,
        latencyMs: 45,
        errorType: null,
        errorMessage: null,
      },
    },
  })),
  getProviderEndpointProbeLogs: vi.fn(async () => ({
    ok: true,
    data: { endpointId: 100, logs: [] },
  })),
  getEndpointCircuitInfo: vi.fn(async () => ({
    ok: true,
    data: {
      endpointId: 100,
      health: {
        failureCount: 0,
        lastFailureTime: null,
        circuitState: "closed" as const,
        circuitOpenUntil: null,
        halfOpenSuccessCount: 0,
      },
      config: {
        failureThreshold: 5,
        openDuration: 1800000,
        halfOpenSuccessThreshold: 2,
      },
    },
  })),
  resetEndpointCircuit: vi.fn(async () => ({ ok: true })),
  editProviderVendor: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { vendor: { ...RAW_VENDOR, displayName: input.displayName ?? RAW_VENDOR.displayName } },
  })),
  removeProviderVendor: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") {
        return {
          user: {
            id: -1,
            name: "Admin",
            description: "test admin",
            role: "admin",
            rpm: 0,
            dailyQuota: 0,
            providerGroup: null,
            isEnabled: true,
            expiresAt: null,
            limit5hResetMode: "rolling",
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          key: {
            id: -1,
            userId: -1,
            name: "admin",
            key: "admin-test-token",
            isEnabled: true,
            canLoginWebUi: true,
            providerGroup: null,
            limit5hUsd: null,
            limit5hResetMode: "rolling",
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitConcurrentSessions: 0,
            cacheTtlPreference: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }
      return null;
    }),
  };
});

const route = await import("@/app/api/v1/[...route]/route");
const { GET, POST, PATCH, DELETE } = route;

function authedRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Request {
  const url = new URL(path, "http://localhost");
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      "X-Api-Key": "admin-test-token",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return new Request(url, init);
}

describe("/api/v1/provider-vendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /provider-vendors returns vendor list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/provider-vendors"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(10);
  });

  it("GET /provider-vendors/{id} returns vendor", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/provider-vendors/10"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.displayName).toBe("Anthropic");
  });

  it("PATCH /provider-vendors/{id} returns updated vendor", async () => {
    const res = await PATCH(
      authedRequest("PATCH", "/api/v1/provider-vendors/10", { displayName: "New Name" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.displayName).toBe("New Name");
  });

  it("DELETE /provider-vendors/{id} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/provider-vendors/10"));
    expect(res.status).toBe(204);
  });

  it("GET /provider-vendors/{id}/endpoints filters hidden providerType", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/provider-vendors/10/endpoints"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].providerType).toBe("claude");
  });

  it("POST /provider-vendors/{id}/endpoints returns 201 + Location", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/provider-vendors/10/endpoints", {
        providerType: "claude",
        url: "https://new.anthropic.com",
        label: "secondary",
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toContain("/api/v1/provider-endpoints/");
  });
});

describe("/api/v1/provider-endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH /provider-endpoints/{id} returns updated endpoint", async () => {
    const res = await PATCH(
      authedRequest("PATCH", "/api/v1/provider-endpoints/100", { isEnabled: false })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isEnabled).toBe(false);
  });

  it("DELETE /provider-endpoints/{id} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/provider-endpoints/100"));
    expect(res.status).toBe(204);
  });

  it("POST /provider-endpoints/{id}:probe returns probe result", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/provider-endpoints/100:probe", { timeoutMs: 5000 })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { ok: boolean } };
    expect(body.result.ok).toBe(true);
  });

  it("GET /provider-endpoints/{id}/probe-logs returns log list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/provider-endpoints/100/probe-logs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { endpointId: number; logs: unknown[] };
    expect(body.endpointId).toBe(100);
  });

  it("GET /provider-endpoints/{id}/circuit returns circuit info", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/provider-endpoints/100/circuit"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { health: { circuitState: string } };
    expect(body.health.circuitState).toBe("closed");
  });

  it("POST /provider-endpoints/{id}/circuit:reset returns ok", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/provider-endpoints/100/circuit:reset"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
