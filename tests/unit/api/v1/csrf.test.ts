/**
 * /api/v1 CSRF：单元测试
 *
 * 验证：
 * - cookie-auth POST：缺失 X-CCH-CSRF → 403 problem+json errorCode=csrf_invalid；
 * - cookie-auth POST：带正确 X-CCH-CSRF → 200；
 * - api-key POST：缺失 X-CCH-CSRF → 200（跳过 CSRF 校验）；
 * - GET /api/v1/auth/csrf：cookie 会话返回 { csrfToken: <string>, mode: "cookie" }；
 * - 校验函数接受当前桶与上一桶。
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
import { AUTH_MODE_CONTEXT_KEY, SESSION_CONTEXT_KEY } from "@/lib/api/v1/_shared/audit-context";
import {
  __resetCsrfSecretCacheForTests,
  CSRF_TOKEN_HEADER,
  generateCsrfToken,
  requireCsrf,
  validateCsrfToken,
} from "@/lib/api/v1/_shared/csrf";
import type { AuthSession } from "@/lib/auth";

function makeFakeSession(role: "admin" | "user" = "user"): AuthSession {
  const now = new Date();
  return {
    user: {
      id: 17,
      name: "csrf-user",
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
      id: 5,
      userId: 17,
      key: "csrf-token-secret",
      name: "key",
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
      createdAt: now,
      updatedAt: now,
    },
  } as AuthSession;
}

function makeProtectedApp() {
  const app = new Hono();
  app.use("*", requireAuth({ tier: "read" }));
  app.use("*", requireCsrf());
  app.post("/probe", (c) => c.json({ ok: true }));
  app.get("/probe", (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  mockValidateAuthToken.mockReset();
  mockIsApiKeyAdminAccessEnabled.mockReset();
  mockIsApiKeyAdminAccessEnabled.mockReturnValue(false);
  __resetCsrfSecretCacheForTests();
  process.env.ADMIN_TOKEN = "csrf-secret-key-for-test";
});

describe("CSRF token core helpers", () => {
  it("validateCsrfToken accepts a freshly generated token", () => {
    const token = generateCsrfToken("user-token", 42);
    expect(validateCsrfToken(token, "user-token", 42)).toBe(true);
  });

  it("validateCsrfToken rejects empty / mismatched tokens", () => {
    expect(validateCsrfToken("", "u", 1)).toBe(false);
    expect(validateCsrfToken("not-a-token", "u", 1)).toBe(false);
  });

  it("validateCsrfToken accepts the previous time bucket (1-hour window grace)", async () => {
    // simulate a token from one bucket ago by spying on Date.now
    const realNow = Date.now();
    const oldNow = realNow - 60 * 60 * 1000 - 5000; // ~1h5m earlier
    const spy = vi.spyOn(Date, "now").mockReturnValue(oldNow);
    const oldToken = generateCsrfToken("user-token", 1);
    spy.mockRestore();
    // current bucket should still validate the old token (1-bucket grace)
    expect(validateCsrfToken(oldToken, "user-token", 1)).toBe(true);
  });
});

describe("requireCsrf middleware - cookie session", () => {
  it("rejects cookie POST without X-CCH-CSRF header (403)", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeProtectedApp();
    const req = new Request("http://localhost/probe", { method: "POST" });
    req.headers.set("Cookie", "auth-token=csrf-token-secret");
    const response = await app.fetch(req);
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe("csrf_invalid");
  });

  it("accepts cookie POST with valid X-CCH-CSRF header (200)", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeProtectedApp();
    const session = makeFakeSession();
    const csrf = generateCsrfToken(session.key.key, session.user.id);
    const req = new Request("http://localhost/probe", { method: "POST" });
    req.headers.set("Cookie", "auth-token=csrf-token-secret");
    req.headers.set(CSRF_TOKEN_HEADER, csrf);
    const response = await app.fetch(req);
    expect(response.status).toBe(200);
  });
});

describe("requireCsrf middleware - api-key tier skip", () => {
  it("api-key POST without X-CCH-CSRF header is allowed (skip)", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeProtectedApp();
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        method: "POST",
        headers: { "X-Api-Key": "csrf-token-secret" },
      })
    );
    expect(response.status).toBe(200);
  });

  it("Bearer (non-admin) POST without X-CCH-CSRF header is allowed (skip)", async () => {
    // Bearer 非 ADMIN_TOKEN 调用应被归类为 api-key 模式，跳过 CSRF。
    // 之前会被错误归类为 "session"，导致脚本/CLI 使用 Bearer API key 时
    // 在突变端点 403 csrf_invalid。
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeProtectedApp();
    const response = await app.fetch(
      new Request("http://localhost/probe", {
        method: "POST",
        headers: { Authorization: "Bearer csrf-token-secret" },
      })
    );
    expect(response.status).toBe(200);
  });

  it("safe methods (GET/HEAD/OPTIONS) skip CSRF even on cookie session", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeProtectedApp();
    const req = new Request("http://localhost/probe", { method: "GET" });
    req.headers.set("Cookie", "auth-token=csrf-token-secret");
    const response = await app.fetch(req);
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/auth/csrf endpoint behavior", () => {
  function makeCsrfApp() {
    // Mirror app.ts: requireAuth(read) + handler that returns generated token
    const app = new Hono();
    app.use("*", requireAuth({ tier: "read" }));
    app.get("/auth/csrf", (c) => {
      const ctx = c as unknown as { get(k: string): unknown };
      const session = ctx.get(SESSION_CONTEXT_KEY) as AuthSession | null;
      const mode = ctx.get(AUTH_MODE_CONTEXT_KEY) as
        | "session"
        | "api-key"
        | "admin-token"
        | null
        | undefined;
      if (mode !== "session" || !session) {
        return c.json({ csrfToken: null, mode: mode ?? "api-key" }, 200);
      }
      const token = generateCsrfToken(session.key.key, session.user.id);
      return c.json({ csrfToken: token, mode: "cookie" }, 200);
    });
    return app;
  }

  it("returns { csrfToken: <string>, mode: 'cookie' } for cookie session", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeCsrfApp();
    const req = new Request("http://localhost/auth/csrf");
    req.headers.set("Cookie", "auth-token=csrf-token-secret");
    const response = await app.fetch(req);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { csrfToken: string; mode: string };
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken.length).toBeGreaterThan(10);
    expect(body.mode).toBe("cookie");
  });

  it("returns { csrfToken: null } for api-key session", async () => {
    mockValidateAuthToken.mockResolvedValueOnce(makeFakeSession());
    const app = makeCsrfApp();
    const response = await app.fetch(
      new Request("http://localhost/auth/csrf", {
        headers: { "X-Api-Key": "csrf-token-secret" },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { csrfToken: null; mode: string };
    expect(body.csrfToken).toBeNull();
    expect(body.mode).toBe("api-key");
  });
});

describe("requireAuth - malformed cookie tolerance", () => {
  it("does not throw URIError when cookie value contains invalid percent-encoding", async () => {
    // 之前 decodeURIComponent("%") 会抛 URIError，让中间件以 500 收尾，
    // 现在通过 hono/cookie 的 getCookie + try/catch 兜底，应当回退到「无 token」
    // 走标准 401 problem+json 流程。
    const app = new Hono();
    app.use("*", requireAuth({ tier: "read" }));
    app.get("/probe", (c) => c.json({ ok: true }));
    const req = new Request("http://localhost/probe");
    req.headers.set("Cookie", "auth-token=%E0%A4%A");
    const response = await app.fetch(req);
    // 不能是 500；应该是 401（无可用 token）。
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  });
});
