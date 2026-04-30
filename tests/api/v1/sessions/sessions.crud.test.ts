/**
 * /api/v1/sessions integration tests (read tier; action enforces self-scope).
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

const RAW_SESSION = {
  sessionId: "session-abc",
  userId: 1,
  userName: "alice",
  startedAt: new Date("2026-04-01T00:00:00Z"),
  lastActiveAt: new Date("2026-04-01T00:05:00Z"),
  isActive: true,
};

vi.mock("@/actions/active-sessions", () => ({
  getActiveSessions: vi.fn(async () => ({ ok: true, data: [RAW_SESSION] })),
  getAllSessions: vi.fn(async () => ({
    ok: true,
    data: { active: [], inactive: [], activeTotal: 0, inactiveTotal: 0 },
  })),
  getSessionDetails: vi.fn(async () => ({ ok: true, data: RAW_SESSION })),
  getSessionMessages: vi.fn(async () => ({
    ok: true,
    data: { messages: [] },
  })),
  hasSessionMessages: vi.fn(async () => ({ ok: true, data: true })),
  getSessionRequests: vi.fn(async () => ({
    ok: true,
    data: { requests: [], total: 0 },
  })),
  terminateActiveSession: vi.fn(async () => ({ ok: true, data: undefined })),
  terminateActiveSessionsBatch: vi.fn(async () => ({
    ok: true,
    data: { terminatedCount: 0 },
  })),
}));

vi.mock("@/actions/session-origin-chain", () => ({
  getSessionOriginChain: vi.fn(async () => ({
    ok: true,
    data: { chain: [], rootSessionId: "session-abc" },
  })),
}));

vi.mock("@/actions/session-response", () => ({
  getSessionResponse: vi.fn(async () => ({ ok: true, data: '{"role":"assistant"}' })),
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

describe("/api/v1/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns active sessions", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/sessions"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionId).toBe("session-abc");
  });

  it("GET /{sessionId} returns session detail", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/sessions/session-abc"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sessionId).toBe("session-abc");
  });

  it("GET /{sessionId}/origin-chain returns origin chain", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/sessions/session-abc/origin-chain"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chain: Record<string, unknown> | null };
    expect(body.chain).toBeDefined();
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/sessions"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("readonly key on read tier → 200 (allowed)", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/sessions", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    expect(res.status).toBe(200);
  });
});
