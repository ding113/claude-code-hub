/**
 * /api/v1/providers CRUD + key:reveal integration tests.
 *
 * 覆盖：
 * - GET 列表脱敏 + 隐藏类型过滤；
 * - GET /{id} 命中与 404；
 * - POST + Location；
 * - PATCH 200 + 序列化;
 * - DELETE 204；
 * - POST /{id}/circuit:reset 200；
 * - GET /{id}/key:reveal 返回原始 key + Cache-Control: no-store（issue #1123）。
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

const RAW_PROVIDER = {
  id: 1,
  name: "Anthropic Direct",
  url: "https://api.anthropic.com",
  maskedKey: "sk-A•••••B0c1",
  key: "sk-RAW-PROVIDER-KEY-FULL-VALUE",
  isEnabled: true,
  weight: 10,
  priority: 0,
  groupPriorities: null,
  costMultiplier: 1,
  groupTag: null,
  providerType: "claude" as const,
  providerVendorId: null,
  preserveClientIp: false,
  disableSessionReuse: false,
  modelRedirects: null,
  activeTimeStart: null,
  activeTimeEnd: null,
  allowedModels: null,
  allowedClients: [],
  blockedClients: [],
  mcpPassthroughType: "none",
  mcpPassthroughUrl: null,
  limit5hUsd: null,
  limit5hResetMode: "rolling" as const,
  limitDailyUsd: null,
  dailyResetMode: "fixed" as const,
  dailyResetTime: "00:00",
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: null,
  totalCostResetAt: null,
  limitConcurrentSessions: 0,
  maxRetryAttempts: null,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerOpenDuration: 1800000,
  circuitBreakerHalfOpenSuccessThreshold: 2,
  proxyUrl: null,
  proxyFallbackToDirect: false,
  customHeaders: null,
  firstByteTimeoutStreamingMs: 60000,
  streamingIdleTimeoutMs: 120000,
  requestTimeoutNonStreamingMs: 300000,
  websiteUrl: null,
  faviconUrl: null,
  cacheTtlPreference: "inherit" as const,
  swapCacheTtlBilling: false,
  context1mPreference: "inherit",
  codexReasoningEffortPreference: "inherit",
  codexReasoningSummaryPreference: "inherit",
  codexTextVerbosityPreference: "inherit",
  codexParallelToolCallsPreference: "inherit",
  codexServiceTierPreference: "inherit",
  anthropicMaxTokensPreference: "inherit",
  anthropicThinkingBudgetPreference: "inherit",
  anthropicAdaptiveThinking: null,
  geminiGoogleSearchPreference: "inherit",
  tpm: null,
  rpm: null,
  rpd: null,
  cc: null,
  createdAt: "2026-04-01",
  updatedAt: "2026-04-01",
  todayTotalCostUsd: "0",
  todayCallCount: 0,
  lastCallTime: null,
  lastCallModel: null,
};

const HIDDEN_PROVIDER = {
  ...RAW_PROVIDER,
  id: 2,
  name: "Hidden Claude Auth",
  providerType: "claude-auth" as const,
};

vi.mock("@/actions/providers", () => ({
  getProviders: vi.fn(async () => [RAW_PROVIDER, HIDDEN_PROVIDER]),
  getProviderStatisticsAsync: vi.fn(async () => ({ "1": { todayCost: "0", todayCalls: 0 } })),
  addProvider: vi.fn(async () => ({ ok: true })),
  editProvider: vi.fn(async () => ({ ok: true, data: { undoToken: "u", operationId: "o" } })),
  removeProvider: vi.fn(async () => ({ ok: true, data: { undoToken: "u", operationId: "o" } })),
  getProvidersHealthStatus: vi.fn(async () => ({})),
  resetProviderCircuit: vi.fn(async () => ({ ok: true })),
  resetProviderTotalUsage: vi.fn(async () => ({ ok: true })),
  batchResetProviderCircuits: vi.fn(async () => ({ ok: true, data: { resetCount: 0 } })),
  getAvailableProviderGroups: vi.fn(async () => ["default"]),
  getProviderGroupsWithCount: vi.fn(async () => ({
    ok: true,
    data: [{ group: "default", providerCount: 1 }],
  })),
  autoSortProviderPriority: vi.fn(async () => ({
    ok: true,
    data: {
      groups: [],
      changes: [],
      summary: { totalProviders: 0, changedCount: 0, groupCount: 0 },
      applied: true,
    },
  })),
  batchUpdateProviders: vi.fn(async () => ({ ok: true, data: { updatedCount: 1 } })),
  getUnmaskedProviderKey: vi.fn(async (id: number) => ({
    ok: true,
    data: { key: id === 1 ? "sk-RAW-PROVIDER-KEY-FULL-VALUE" : "" },
  })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") return adminSession();
      return null;
    }),
  };
});

function adminSession() {
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

describe("/api/v1/providers — CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /providers filters hidden providerType and serializes maskedKey", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/providers"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    // claude-auth must be filtered out
    expect(body.items).toHaveLength(1);
    expect(body.items[0].providerType).toBe("claude");
    expect(typeof body.items[0].maskedKey).toBe("string");
    // raw key never leaks in list
    expect(JSON.stringify(body)).not.toContain("FULL-VALUE");
  });

  it("GET /providers?include=statistics returns items + statistics", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/providers?include=statistics"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; statistics: Record<string, unknown> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.statistics).toBe("object");
  });

  it("GET /providers/{id} returns 200 for visible provider", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/providers/1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
  });

  it("GET /providers/{id} returns 404 for hidden providerType", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/providers/2"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("POST /providers returns 201 + Location", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/providers", {
        name: "Anthropic Direct",
        url: "https://api.anthropic.com",
        key: "sk-ant-NEW",
        providerType: "claude",
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toContain("/api/v1/providers/");
  });

  it("PATCH /providers/{id} returns 200 with provider", async () => {
    const res = await PATCH(authedRequest("PATCH", "/api/v1/providers/1", { weight: 20 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
  });

  it("DELETE /providers/{id} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/providers/1"));
    expect(res.status).toBe(204);
  });

  it("POST /providers/{id}/circuit:reset returns ok", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/providers/1/circuit:reset"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("/api/v1/providers — issue #1123 key:reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /providers/{id}/key:reveal returns full raw key + Cache-Control no-store", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/providers/1/key:reveal"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    const body = (await res.json()) as { id: number; key: string };
    expect(body.id).toBe(1);
    expect(body.key).toBe("sk-RAW-PROVIDER-KEY-FULL-VALUE");
  });
});
