/**
 * /api/v1/request-filters integration tests (admin tier).
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

const RAW_FILTER = {
  id: 1,
  name: "block-internal",
  description: "Block internal endpoints",
  scope: "global" as const,
  scopeIds: [],
  matchType: "regex" as const,
  pattern: "/internal/.*",
  patternFlags: "i",
  matchAgainst: "url" as const,
  action: "reject" as const,
  isEnabled: true,
  priority: 0,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

vi.mock("@/actions/request-filters", () => ({
  // listRequestFilters returns raw array (treatRawAsActionResult)
  listRequestFilters: vi.fn(async () => [RAW_FILTER]),
  createRequestFilterAction: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_FILTER, ...input, id: 99 },
  })),
  updateRequestFilterAction: vi.fn(async (id: number, input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_FILTER, ...input, id },
  })),
  deleteRequestFilterAction: vi.fn(async () => ({ ok: true, data: undefined })),
  refreshRequestFiltersCache: vi.fn(async () => ({
    ok: true,
    data: { refreshed: true, count: 1 },
  })),
  listProvidersForFilterAction: vi.fn(async () => ({
    ok: true,
    data: [{ id: 1, name: "openai" }],
  })),
  getDistinctProviderGroupsAction: vi.fn(async () => ({
    ok: true,
    data: ["default", "claude-only"],
  })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") {
        return adminSession();
      }
      if (token === "readonly-key") {
        return readonlySession();
      }
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

function readonlySession() {
  return {
    user: {
      id: 7,
      name: "user",
      description: "",
      role: "user",
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
      id: 9,
      userId: 7,
      name: "readonly",
      key: "readonly-key",
      isEnabled: true,
      canLoginWebUi: false,
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
const { GET } = route;

function authedRequest(method: string, path: string, headers?: Record<string, string>): Request {
  const url = new URL(path, "http://localhost");
  return new Request(url, {
    method,
    headers: {
      "X-Api-Key": "admin-test-token",
      ...(headers ?? {}),
    },
  });
}

describe("/api/v1/request-filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/request-filters"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("block-internal");
  });

  it("GET /options/providers returns provider list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/request-filters/options/providers"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: number; name: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("openai");
  });

  it("GET /options/groups returns groups list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/request-filters/options/groups"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: string[] };
    expect(body.items).toContain("default");
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/request-filters"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("readonly key on admin tier → 401 / 403", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/request-filters", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    expect([401, 403]).toContain(res.status);
  });
});
