import { describe, expect, test, vi } from "vitest";
import "@/lib/auth-session-storage.node";

const redisReadMock = vi.hoisted(() => vi.fn());

/**
 * 回归用例：/api/actions adapter 鉴权通过后，action 内部调用 getSession() 仍应拿到会话
 *
 * 背景：
 * - adapter 层使用 hono 读取 Cookie/Authorization 并 validateKey
 * - action 层传统依赖 next/headers 读取请求上下文
 * - 某些运行时下 action 读取不到上下文，导致返回 ok 但 data 为空
 *
 * 期望：
 * - adapter 在调用 action 时注入 session（AsyncLocalStorage）
 * - action 内 getSession() 优先读取注入会话，不触发 next/headers
 */

vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("不应在该用例中调用 next/headers.cookies()");
  },
  headers: () => ({
    get: () => null,
  }),
}));

describe("Action Adapter：会话透传", () => {
  test("requiresAuth=true：action 内 getSession() 应返回注入的 session", async () => {
    vi.resetModules();

    const mockSession = {
      user: {
        id: 123,
        name: "u1",
        description: "",
        role: "user" as const,
        rpm: null,
        dailyQuota: null,
        providerGroup: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
        limit5hResetMode: "rolling" as const,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        isEnabled: true,
        expiresAt: null,
        allowedClients: [],
        allowedModels: [],
      },
      key: {
        id: 1,
        userId: 123,
        name: "k1",
        key: "token-1",
        isEnabled: true,
        expiresAt: undefined,
        canLoginWebUi: false,
        limit5hUsd: null,
        limit5hResetMode: "rolling" as const,
        limitDailyUsd: null,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
      },
    };

    vi.doMock("@/lib/auth", async (importActual) => {
      const actual = (await importActual()) as typeof import("@/lib/auth");
      return {
        ...actual,
        validateKey: vi.fn(async () => mockSession),
        validateAuthToken: vi.fn(async () => mockSession),
      };
    });

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const { getSession, validateAuthToken } = await import("@/lib/auth");

    const action = vi.fn(async () => {
      const session = await getSession();
      // 显式降权校验：当 key 为只读（canLoginWebUi=false）时，strict session 应返回 null
      const strictSession = await getSession({ allowReadOnlyAccess: false });
      return {
        ok: true,
        data: { userId: session?.user.id ?? null, strictUserId: strictSession?.user.id ?? null },
      };
    });

    const { handler } = createActionRoute("users", "getUsers", action as any, {
      requiresAuth: true,
      allowReadOnlyAccess: true,
    });

    const response = (await handler({
      req: {
        raw: new Request("http://localhost/api/actions/users/getUsers", {
          headers: new Headers(),
        }),
        json: async () => ({}),
        header: (name: string) => {
          if (name.toLowerCase() === "authorization") return "Bearer token-1";
          return undefined;
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    } as any)) as Response;

    expect(validateAuthToken).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { userId: 123, strictUserId: null },
    });
  });

  test("admin 路由默认拒绝 bearer 形式的用户 API Key", async () => {
    vi.resetModules();

    const mockSession = {
      user: {
        id: 123,
        name: "admin",
        description: "",
        role: "admin" as const,
        rpm: null,
        dailyQuota: null,
        providerGroup: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
        limit5hResetMode: "rolling" as const,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        isEnabled: true,
        expiresAt: null,
        allowedClients: [],
        allowedModels: [],
      },
      key: {
        id: 1,
        userId: 123,
        name: "admin-key",
        key: "legacy-admin-api-key",
        isEnabled: true,
        expiresAt: undefined,
        canLoginWebUi: true,
        limit5hUsd: null,
        limit5hResetMode: "rolling" as const,
        limitDailyUsd: null,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
      },
    };

    vi.doMock("@/lib/auth", async (importActual) => {
      const actual = (await importActual()) as typeof import("@/lib/auth");
      return {
        ...actual,
        validateAuthToken: vi.fn(async () => mockSession),
      };
    });

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const action = vi.fn(async () => ({ ok: true, data: "ok" }));
    const { handler } = createActionRoute("providers", "getProviders", action as any, {
      requiresAuth: true,
      requiredRole: "admin",
    });

    const response = (await handler({
      req: {
        raw: new Request("http://localhost/api/actions/providers/getProviders", {
          headers: new Headers(),
        }),
        json: async () => ({}),
        header: (name: string) => {
          if (name.toLowerCase() === "authorization") return "Bearer legacy-admin-api-key";
          return undefined;
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    } as any)) as Response;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "auth.api_key_admin_disabled",
    });
    expect(action).not.toHaveBeenCalled();
  });

  test("admin 路由默认拒绝 opaque cookie 中的用户 API Key 会话", async () => {
    vi.resetModules();
    redisReadMock.mockResolvedValue({
      sessionId: "sid_user_admin_key",
      keyFingerprint: "sha256:user",
      credentialType: "user-api-key",
      userId: 123,
      userRole: "admin",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    const mockSession = {
      user: {
        id: 123,
        name: "admin",
        description: "",
        role: "admin" as const,
        rpm: null,
        dailyQuota: null,
        providerGroup: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
        limit5hResetMode: "rolling" as const,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        isEnabled: true,
        expiresAt: null,
        allowedClients: [],
        allowedModels: [],
      },
      key: {
        id: 1,
        userId: 123,
        name: "admin-key",
        key: "db-admin-key",
        isEnabled: true,
        expiresAt: undefined,
        canLoginWebUi: true,
        limit5hUsd: null,
        limit5hResetMode: "rolling" as const,
        limitDailyUsd: null,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
      },
    };

    vi.doMock("@/lib/auth", async (importActual) => {
      const actual = (await importActual()) as typeof import("@/lib/auth");
      return {
        ...actual,
        validateAuthToken: vi.fn(async () => mockSession),
      };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const action = vi.fn(async () => ({ ok: true, data: "ok" }));
    const { handler } = createActionRoute("providers", "getProviders", action as any, {
      requiresAuth: true,
      requiredRole: "admin",
    });

    const request = new Request("http://localhost/api/actions/providers/getProviders", {
      method: "POST",
      headers: new Headers({ cookie: "auth-token=sid_user_admin_key" }),
    });

    const response = (await handler({
      req: {
        raw: request,
        json: async () => ({}),
        header: (name: string) =>
          name.toLowerCase() === "cookie"
            ? "auth-token=sid_user_admin_key"
            : (request.headers.get(name) ?? undefined),
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    } as any)) as Response;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "auth.api_key_admin_disabled",
    });
    expect(redisReadMock).toHaveBeenCalledWith("sid_user_admin_key");
    expect(action).not.toHaveBeenCalled();
  });

  test("admin 路由默认拒绝 opaque 凭据来源读取失败的会话", async () => {
    vi.resetModules();
    redisReadMock.mockRejectedValue(new Error("redis unavailable"));

    const mockSession = {
      user: {
        id: 123,
        name: "admin",
        description: "",
        role: "admin" as const,
        rpm: null,
        dailyQuota: null,
        providerGroup: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
        limit5hResetMode: "rolling" as const,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        isEnabled: true,
        expiresAt: null,
        allowedClients: [],
        allowedModels: [],
      },
      key: {
        id: 1,
        userId: 123,
        name: "admin-key",
        key: "db-admin-key",
        isEnabled: true,
        expiresAt: undefined,
        canLoginWebUi: true,
        limit5hUsd: null,
        limit5hResetMode: "rolling" as const,
        limitDailyUsd: null,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
      },
    };

    vi.doMock("@/lib/auth", async (importActual) => {
      const actual = (await importActual()) as typeof import("@/lib/auth");
      return {
        ...actual,
        validateAuthToken: vi.fn(async () => mockSession),
      };
    });
    vi.doMock("@/lib/auth-session-store/redis-session-store", () => ({
      RedisSessionStore: class {
        read = redisReadMock;
      },
    }));

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const action = vi.fn(async () => ({ ok: true, data: "ok" }));
    const { handler } = createActionRoute("providers", "getProviders", action as any, {
      requiresAuth: true,
      requiredRole: "admin",
    });

    const request = new Request("http://localhost/api/actions/providers/getProviders", {
      method: "POST",
      headers: new Headers({ cookie: "auth-token=sid_broken" }),
    });

    const response = (await handler({
      req: {
        raw: request,
        json: async () => ({}),
        header: (name: string) =>
          name.toLowerCase() === "cookie"
            ? "auth-token=sid_broken"
            : (request.headers.get(name) ?? undefined),
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    } as any)) as Response;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "auth.api_key_admin_disabled",
    });
    expect(redisReadMock).toHaveBeenCalledWith("sid_broken");
    expect(action).not.toHaveBeenCalled();
  });

  test("cookie 鉴权的 legacy mutation 需要 CSRF token", async () => {
    vi.resetModules();

    const mockSession = {
      user: {
        id: 123,
        name: "admin",
        description: "",
        role: "admin" as const,
        rpm: null,
        dailyQuota: null,
        providerGroup: null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
        limit5hResetMode: "rolling" as const,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        isEnabled: true,
        expiresAt: null,
        allowedClients: [],
        allowedModels: [],
      },
      key: {
        id: 1,
        userId: 123,
        name: "admin-session",
        key: "cookie-session-token",
        isEnabled: true,
        expiresAt: undefined,
        canLoginWebUi: true,
        limit5hUsd: null,
        limit5hResetMode: "rolling" as const,
        limitDailyUsd: null,
        dailyResetMode: "fixed" as const,
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: 0,
        providerGroup: null,
        cacheTtlPreference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: undefined,
      },
    };

    vi.doMock("@/lib/auth", async (importActual) => {
      const actual = (await importActual()) as typeof import("@/lib/auth");
      return {
        ...actual,
        validateAuthToken: vi.fn(async () => mockSession),
      };
    });

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const action = vi.fn(async () => ({ ok: true, data: "ok" }));
    const { handler } = createActionRoute("model-prices", "syncLiteLLMPrices", action as any, {
      requiresAuth: true,
      requiredRole: "admin",
    });

    const request = new Request("http://localhost/api/actions/model-prices/syncLiteLLMPrices", {
      method: "POST",
      headers: new Headers({ cookie: "auth-token=cookie-session-token" }),
    });

    const response = (await handler({
      req: {
        raw: request,
        json: async () => ({}),
        header: (name: string) => {
          if (name.toLowerCase() === "cookie") return "auth-token=cookie-session-token";
          return request.headers.get(name) ?? undefined;
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    } as any)) as Response;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "auth.csrf_invalid",
    });
    expect(action).not.toHaveBeenCalled();
  });

  test("畸形 auth-token cookie 不应升级为 500", async () => {
    vi.resetModules();

    vi.doMock("@/lib/auth", async (importActual) => {
      const actual = (await importActual()) as typeof import("@/lib/auth");
      return {
        ...actual,
        validateAuthToken: vi.fn(async () => null),
      };
    });

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const action = vi.fn(async () => ({ ok: true, data: "ok" }));
    const { handler } = createActionRoute("users", "getUsers", action as any, {
      requiresAuth: true,
      allowReadOnlyAccess: true,
    });

    const request = new Request("http://localhost/api/actions/users/getUsers", {
      method: "POST",
      headers: new Headers({ cookie: "auth-token=%E0%A4%A" }),
    });

    const response = (await handler({
      req: {
        raw: request,
        json: async () => ({}),
        header: (name: string) => request.headers.get(name) ?? undefined,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    } as any)) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "未认证",
    });
    expect(action).not.toHaveBeenCalled();
  });
});
