/**
 * /api/v1 三层鉴权中间件 - 公共行为单元测试
 *
 * 验证：
 * - public：无 token 仍 200，session=null 写入 context；
 * - read：无 token → 401 problem+json errorCode=auth_invalid + Cache-Control: no-store；
 * - read：valid Bearer / X-Api-Key / Cookie 均放行；
 * - read：invalid token → 401；
 * - admin：read-only key → 403；
 * - admin：ADMIN_TOKEN 环境匹配 → 200；
 * - admin：非 admin user → 403。
 *
 * 注意：通过 vi.mock 拦截 `@/lib/auth.validateAuthToken`，避免真实数据库依赖。
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateAuthToken = vi.hoisted(() => vi.fn());
const mockIsApiKeyAdminAccessEnabled = vi.hoisted(() => vi.fn(() => false));
const mockGetEnvConfig = vi.hoisted(() => vi.fn());

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
    getEnvConfig: mockGetEnvConfig.mockImplementation(() => actual.getEnvConfig()),
  };
});

vi.mock("@/lib/config/config", () => ({
  config: {
    auth: {
      get adminToken() {
        return process.env.__ADMIN_TOKEN_FOR_TEST ?? null;
      },
    },
  },
}));

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { AUTH_MODE_CONTEXT_KEY, SESSION_CONTEXT_KEY } from "@/lib/api/v1/_shared/audit-context";
import type { AuthSession } from "@/lib/auth";

function makeFakeSession(role: "admin" | "user", canLoginWebUi = true): AuthSession {
  const now = new Date();
  return {
    user: {
      id: 42,
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
      id: 1,
      userId: 42,
      key: "test-token-abc",
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

function makeApp(tier: "public" | "read" | "admin") {
  const app = new Hono();
  app.use("*", requireAuth({ tier }));
  app.get("/probe", (c) => {
    const ctx = c as unknown as { get(k: string): unknown };
    return c.json({
      ok: true,
      hasSession: ctx.get(SESSION_CONTEXT_KEY) !== null,
      mode: ctx.get(AUTH_MODE_CONTEXT_KEY),
    });
  });
  return app;
}

beforeEach(() => {
  mockValidateAuthToken.mockReset();
  mockIsApiKeyAdminAccessEnabled.mockReset();
  mockIsApiKeyAdminAccessEnabled.mockReturnValue(false);
  delete process.env.__ADMIN_TOKEN_FOR_TEST;
});

describe("requireAuth({ tier: 'public' })", () => {
  it("passes through with session=null when no token is provided", async () => {
    const app = makeApp("public");
    const response = await app.fetch(new Request("http://localhost/probe"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; hasSession: boolean };
    expect(body.ok).toBe(true);
    expect(body.hasSession).toBe(false);
    expect(mockValidateAuthToken).not.toHaveBeenCalled();
  });
});

describe("requireAuth({ tier: 'read' })", () => {
  it("returns 401 problem+json with errorCode=auth_invalid when no token provided", async () => {
    const app = makeApp("read");
    const response = await app.fetch(new Request("http://localhost/probe"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("auth_invalid");
  });

  it("accepts a valid Bearer token", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("user"));
    const app = makeApp("read");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { Authorization: "Bearer good-token" },
      })
    );
    expect(response.status).toBe(200);
    expect(mockValidateAuthToken).toHaveBeenCalledWith(
      "good-token",
      expect.objectContaining({ allowReadOnlyAccess: true })
    );
  });

  it("accepts a valid X-Api-Key header", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("user"));
    const app = makeApp("read");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Api-Key": "good-token" },
      })
    );
    expect(response.status).toBe(200);
  });

  it("accepts a valid auth-token cookie", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("user"));
    const app = makeApp("read");
    // happy-dom strips Cookie from Request constructor headers per Fetch spec.
    // Workaround: construct empty Request and set Cookie on the live headers.
    const req = new Request("http://localhost/probe");
    req.headers.set("Cookie", "auth-token=good-token; other=ignored");
    const response = await app.fetch(req);
    expect(response.status).toBe(200);
  });

  it("returns 401 when token is invalid (validateAuthToken returns null)", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(null);
    const app = makeApp("read");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { Authorization: "Bearer bad-token" },
      })
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("auth_invalid");
  });
});

describe("requireAuth({ tier: 'admin' })", () => {
  it("returns 403 when read-only key (canLoginWebUi=false) attempts admin access", async () => {
    // admin tier first validates with allowReadOnlyAccess=true to identify the caller,
    // then enforces admin checks. A read-only key returns a valid session with
    // user.role="user" + key.canLoginWebUi=false → 403.
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("user", false));
    const app = makeApp("admin");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { Authorization: "Bearer ro-key" },
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("permission_denied");
  });

  it("accepts ADMIN_TOKEN env match (returns admin session, role=admin)", async () => {
    process.env.__ADMIN_TOKEN_FOR_TEST = "the-admin-token";
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("admin"));
    const app = makeApp("admin");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { Authorization: "Bearer the-admin-token" },
      })
    );
    expect(response.status).toBe(200);
  });

  it("returns 403 when authenticated user has role=user (non-admin)", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("user"));
    const app = makeApp("admin");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { Authorization: "Bearer regular-user-token" },
      })
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("permission_denied");
  });

  it("with ENABLE_API_KEY_ADMIN_ACCESS=true: admin user's API key is allowed", async () => {
    mockIsApiKeyAdminAccessEnabled.mockReturnValue(true);
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession("admin"));
    const app = makeApp("admin");
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        headers: { "X-Api-Key": "admin-user-api-key" },
      })
    );
    expect(response.status).toBe(200);
  });
});
