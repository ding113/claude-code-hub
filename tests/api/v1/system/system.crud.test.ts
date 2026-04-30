/**
 * /api/v1/system settings + timezone integration tests.
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

const RAW_SETTINGS = {
  id: 1,
  siteTitle: "Claude Code Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "redirected",
  codexPriorityBillingSource: "actual",
  timezone: "Asia/Shanghai",
  enableClientVersionCheck: true,
  verboseProviderError: false,
  passThroughUpstreamErrorMessage: false,
  enableHttp2: true,
  enableOpenaiResponsesWebsocket: false,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  allowNonConversationEndpointProviderFallback: true,
  fakeStreamingWhitelist: [],
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  responseFixerConfig: {
    fixTruncatedJson: true,
    fixSseFormat: true,
    fixEncoding: true,
    maxJsonDepth: 100,
    maxFixSize: 1048576,
  },
  ipExtractionConfig: null,
  ipGeoLookupEnabled: false,
  publicStatusWindowHours: 24,
  publicStatusAggregationIntervalMinutes: 5,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-02T00:00:00Z"),
};

vi.mock("@/actions/system-config", () => ({
  fetchSystemSettings: vi.fn(async () => ({ ok: true, data: RAW_SETTINGS })),
  saveSystemSettings: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_SETTINGS, ...input, publicStatusProjectionWarningCode: null },
  })),
  getServerTimeZone: vi.fn(async () => ({
    ok: true,
    data: { timeZone: "Asia/Shanghai" },
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
const { GET, PUT } = route;

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

describe("/api/v1/system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /settings returns full settings", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/system/settings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
    expect(body.siteTitle).toBe("Claude Code Hub");
    expect(body.timezone).toBe("Asia/Shanghai");
  });

  it("PUT /settings updates and returns 200", async () => {
    const res = await PUT(
      authedRequest("PUT", "/api/v1/system/settings", {
        siteTitle: "New Title",
        enableHttp2: false,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.siteTitle).toBe("New Title");
    expect(body.enableHttp2).toBe(false);
  });

  it("PUT /settings rejects invalid timezone with 400 problem+json", async () => {
    const res = await PUT(
      authedRequest("PUT", "/api/v1/system/settings", {
        timezone: "not-a-real-timezone",
      })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("GET /timezone returns timeZone (read tier)", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/system/timezone"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { timeZone: string };
    expect(body.timeZone).toBe("Asia/Shanghai");
  });

  it("unauthenticated GET /settings → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/system/settings"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
