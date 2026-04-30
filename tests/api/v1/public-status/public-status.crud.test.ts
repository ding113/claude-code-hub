/**
 * /api/v1/public/status integration tests.
 *
 * - GET /public/status: fully public (no auth required)
 * - PUT /public/status/settings: admin + CSRF
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

const PUBLIC_STATUS_RESPONSE = {
  status: "ok" as const,
  generatedAt: "2026-04-01T00:00:00Z",
  meta: { siteTitle: "Claude Code Hub", siteDescription: null, timeZone: "Asia/Shanghai" },
  query: { intervalMinutes: 5, rangeHours: 24 },
  defaults: { intervalMinutes: 5, rangeHours: 24 },
  groups: [],
};

// Mock the legacy /api/public-status/route to avoid pulling in real Redis/PG.
vi.mock("@/app/api/public-status/route", () => ({
  GET: vi.fn(async () => {
    return new Response(JSON.stringify(PUBLIC_STATUS_RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
}));

vi.mock("@/actions/public-status", () => ({
  savePublicStatusSettings: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { ...input, savedAt: "2026-04-01T00:00:00Z" },
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

describe("/api/v1/public/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET (public, no auth) → 200 with status payload", async () => {
    const res = await GET(new Request("http://localhost/api/v1/public/status"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });

  it("GET also accepts admin token", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/public/status", {
        headers: { "X-Api-Key": "admin-test-token" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("PUT /settings without auth → 401 problem+json", async () => {
    const res = await PUT(
      new Request("http://localhost/api/v1/public/status/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    // Without admin tier authentication this should be rejected (401 or 403 if CSRF kicks first).
    expect([401, 403]).toContain(res.status);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("PUT /settings with readonly key → 401 / 403", async () => {
    const res = await PUT(
      new Request("http://localhost/api/v1/public/status/settings", {
        method: "PUT",
        headers: {
          Authorization: "Bearer readonly-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect([401, 403]).toContain(res.status);
  });
});
