/**
 * /api/v1 admin tier + ENABLE_API_KEY_ADMIN_ACCESS：单元测试
 *
 * 验证：
 * - 默认（flag=false）：admin tier 拒绝 DB API key（X-Api-Key 头）→ 403；
 * - flag=true 且 key 所有者 role=admin → 200；
 * - flag=true 但 key 所有者 role=user → 403。
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateAuthToken = vi.hoisted(() => vi.fn());
const mockIsApiKeyAdminAccessEnabled = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    validateAuthToken: mockValidateAuthToken,
  };
});

vi.mock("@/lib/config/env.schema", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/config/env.schema")>("@/lib/config/env.schema");
  return {
    ...actual,
    isApiKeyAdminAccessEnabled: mockIsApiKeyAdminAccessEnabled,
  };
});

vi.mock("@/lib/config/config", () => ({
  config: {
    auth: {
      get adminToken() {
        return null;
      },
    },
  },
}));

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import type { AuthSession } from "@/lib/auth";

function makeFakeSession(role: "admin" | "user", canLoginWebUi = true): AuthSession {
  const now = new Date();
  return {
    user: {
      id: 7,
      name: "Test",
      description: "",
      role,
      rpm: null,
      dailyQuota: null,
      providerGroup: null,
      isEnabled: true,
      expiresAt: null,
      limit5hResetMode: "rolling",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      createdAt: now,
      updatedAt: now,
    },
    key: {
      id: 9,
      userId: 7,
      key: "the-api-key",
      name: "key",
      isEnabled: true,
      canLoginWebUi,
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
      createdAt: now,
      updatedAt: now,
    },
  } as AuthSession;
}

function makeAdminApp() {
  const app = new Hono();
  app.use("*", requireAuth({ tier: "admin" }));
  app.get("/probe", (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  mockValidateAuthToken.mockReset();
  mockIsApiKeyAdminAccessEnabled.mockReset();
  mockIsApiKeyAdminAccessEnabled.mockReturnValue(false);
});

describe("admin tier + X-Api-Key + ENABLE_API_KEY_ADMIN_ACCESS", () => {
  it("default flag (false): admin user's API key is rejected with 403", async () => {
    mockIsApiKeyAdminAccessEnabled.mockReturnValue(false);
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("admin"));
    const app = makeAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Api-Key": "admin-user-key" },
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("permission_denied");
  });

  it("flag enabled + key owner role=admin: allowed (200)", async () => {
    mockIsApiKeyAdminAccessEnabled.mockReturnValue(true);
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("admin"));
    const app = makeAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Api-Key": "admin-user-key" },
      })
    );
    expect(response.status).toBe(200);
  });

  it("flag enabled + key owner role=user: rejected (403)", async () => {
    mockIsApiKeyAdminAccessEnabled.mockReturnValue(true);
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("user"));
    const app = makeAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Api-Key": "regular-user-key" },
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("permission_denied");
  });
});
