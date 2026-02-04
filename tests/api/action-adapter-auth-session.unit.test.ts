import { describe, expect, test, vi } from "vitest";
import "@/lib/auth-session-storage.node";

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
      };
    });

    const { createActionRoute } = await import("@/lib/api/action-adapter-openapi");
    const { getSession, validateKey } = await import("@/lib/auth");

    const action = vi.fn(async () => {
      const session = await getSession();
      return { ok: true, data: { userId: session?.user.id ?? null } };
    });

    const { handler } = createActionRoute("users", "getUsers", action as any, {
      requiresAuth: true,
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

    expect(validateKey).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { userId: 123 } });
  });
});
