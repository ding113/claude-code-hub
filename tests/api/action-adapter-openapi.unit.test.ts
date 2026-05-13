import { describe, expect, test, vi } from "vitest";
import { z } from "@hono/zod-openapi";
import {
  IdParamSchema,
  PaginationSchema,
  SortSchema,
  createActionRoute,
  createActionRoutes,
  createParamSchema,
} from "@/lib/api/action-adapter-openapi";
import { logger } from "@/lib/logger";

/**
 * 说明：
 * - 这些测试只覆盖 adapter 的“通用执行器”逻辑
 * - 不依赖 Next/Hono 的完整运行时
 * - 重点验证：参数映射、返回值包装、错误/异常处理、requiresAuth=false 分支
 */

function createMockContext(options?: { body?: unknown; jsonThrows?: boolean }) {
  const body = options?.body ?? {};
  const jsonThrows = options?.jsonThrows ?? false;

  return {
    req: {
      json: async () => {
        if (jsonThrows) {
          throw new Error("invalid json");
        }
        return body;
      },
    },
    json: (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  } as const;
}

describe("Action Adapter：createActionRoute（单元测试）", () => {
  test("requiresAuth=false：返回非 ActionResult 时自动包装 {ok:true,data}", async () => {
    const { handler } = createActionRoute(
      "test",
      "returnsRaw",
      async () => {
        return { hello: "world" };
      },
      { requiresAuth: false }
    );

    const response = (await handler(createMockContext({ body: {} }) as any)) as Response;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { hello: "world" } });
  });

  test("默认参数推断：schema 单字段时应传入该字段值", async () => {
    const action = vi.fn(async (id: number) => ({ id }));
    const { handler } = createActionRoute("test", "singleArg", action as any, {
      requiresAuth: false,
      requestSchema: z.object({ id: z.number() }),
    });

    const response = (await handler(createMockContext({ body: { id: 123 } }) as any)) as Response;
    expect(action).toHaveBeenCalledWith(123);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { id: 123 } });
  });

  test("默认参数推断：多字段 schema 传入整个 body（单参）", async () => {
    const action = vi.fn(async (body: { a: string; b: string }) => body);
    const { handler } = createActionRoute("test", "multiKey", action as any, {
      requiresAuth: false,
      requestSchema: z.object({ a: z.string(), b: z.string() }),
    });

    const response = (await handler(
      createMockContext({ body: { a: "x", b: "y" } }) as any
    )) as Response;
    expect(action).toHaveBeenCalledWith({ a: "x", b: "y" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { a: "x", b: "y" } });
  });

  test("argsMapper：应优先使用显式映射以支持多参数 action", async () => {
    const action = vi.fn(async (userId: number, data: { name: string }) => ({ userId, data }));
    const { handler } = createActionRoute("test", "mappedArgs", action as any, {
      requiresAuth: false,
      requestSchema: z.object({
        userId: z.number(),
        data: z.object({ name: z.string() }),
      }),
      argsMapper: (body: { userId: number; data: { name: string } }) => [body.userId, body.data],
    });

    const response = (await handler(
      createMockContext({ body: { userId: 7, data: { name: "alice" } } }) as any
    )) as Response;
    expect(action).toHaveBeenCalledWith(7, { name: "alice" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { userId: 7, data: { name: "alice" } },
    });
  });

  test("action 返回 ok=false：应返回 400 且透传 errorCode/errorParams", async () => {
    const { handler } = createActionRoute(
      "test",
      "returnsError",
      async () => ({
        ok: false,
        error: "业务错误",
        errorCode: "BIZ_ERROR",
        errorParams: { field: "name" },
      }),
      { requiresAuth: false }
    );

    const response = (await handler(createMockContext({ body: {} }) as any)) as Response;
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "业务错误",
      errorCode: "BIZ_ERROR",
      errorParams: { field: "name" },
    });
  });

  test("action 抛出 Error：应返回 500 且返回 error.message", async () => {
    const { handler } = createActionRoute(
      "test",
      "throwsError",
      async () => {
        throw new Error("boom");
      },
      { requiresAuth: false }
    );

    const response = (await handler(createMockContext({ body: {} }) as any)) as Response;
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "boom" });
  });

  test("action 抛出非 Error：应返回 500 且返回通用错误消息", async () => {
    const { handler } = createActionRoute(
      "test",
      "throwsUnknown",
      async () => {
        // eslint-disable-next-line no-throw-literal
        throw "boom";
      },
      { requiresAuth: false }
    );

    const response = (await handler(createMockContext({ body: {} }) as any)) as Response;
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "服务器内部错误" });
  });

  test("请求体不是 JSON：应降级为 {} 并继续执行", async () => {
    const action = vi.fn(async () => "ok");
    const { handler } = createActionRoute("test", "badJson", action as any, {
      requiresAuth: false,
    });

    const response = (await handler(createMockContext({ jsonThrows: true }) as any)) as Response;
    expect(action).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: "ok" });
  });

  test("legacy provider schema 仍接受旧 provider type", async () => {
    const route = await import("@/app/api/actions/[...route]/route");
    const response = await route.GET(
      new Request("http://localhost/api/actions/openapi.json", { method: "GET" })
    );
    const document = await response.json();
    const providerEndpointsSchema =
      document.paths["/api/actions/providers/getProviderEndpoints"].post.requestBody.content[
        "application/json"
      ].schema;

    expect(providerEndpointsSchema.properties.providerType.enum).toEqual(
      expect.arrayContaining(["claude-auth", "gemini-cli"])
    );
  });

  test("debug 日志不记录管理面请求体中的密钥和 URL 凭据", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const action = vi.fn(async () => ({ ok: true, data: "ok" }));
    const { handler } = createActionRoute("providers", "addProvider", action as any, {
      requiresAuth: false,
      requestSchema: z.object({ key: z.string() }),
    });

    const response = (await handler(
      createMockContext({
        body: {
          key: "sk-provider-secret",
          url: "https://main-user:main-pass@api.example.com/v1",
          providerUrl: "https://provider-user:provider-pass@provider.example.com/v1",
          websiteUrl: "https://web-user:web-pass@example.com",
          webhookUrl: "https://token:secret@example.com/webhook",
          proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
          proxy_url: "https://snake-proxy-user:snake-proxy-pass@proxy.example.com",
          website_url: "https://snake-web-user:snake-web-pass@example.com",
          mcp_passthrough_url: "https://snake-mcp-user:snake-mcp-pass@mcp.example.com/bridge",
          custom_headers: {
            Authorization: "Bearer snake-upstream-secret",
            "X-Trace": "snake-trace-id",
          },
          customHeaders: {
            Authorization: "Bearer upstream-secret",
            "X-Trace": "trace-id",
          },
          input: {
            telegramBotToken: "telegram-secret-token",
            url: "https://nested-main:nested-main-pass@nested-api.example.com/v1",
            providerUrl: "https://nested-provider:nested-provider-pass@nested-provider.example.com",
            websiteUrl: "https://nested-web:nested-web-pass@nested-web.example.com",
            proxyUrl: "https://nested-user:nested-pass@proxy.example.com",
            webhookUrl: "https://nested-token:nested-secret@example.com/webhook",
            customHeaders: {
              "X-Webhook-Secret": "shared-secret",
              "X-Trace": "nested-trace",
            },
          },
          circuitBreakerWebhook: "https://alert-token:alert-secret@example.com/notify",
        },
      }) as any
    )) as Response;

    expect(response.status).toBe(200);
    expect(debugSpy).toHaveBeenCalledWith("[ActionAPI] Calling providers.addProvider", {
      body: expect.objectContaining({
        key: "[REDACTED]",
        url: "https://REDACTED:REDACTED@api.example.com/v1",
        providerUrl: "https://REDACTED:REDACTED@provider.example.com/v1",
        websiteUrl: "https://REDACTED:REDACTED@example.com/",
        webhookUrl: "[REDACTED]",
        proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
        proxy_url: "https://REDACTED:REDACTED@proxy.example.com/",
        website_url: "https://REDACTED:REDACTED@example.com/",
        mcp_passthrough_url: "https://REDACTED:REDACTED@mcp.example.com/bridge",
        custom_headers: {
          Authorization: "[REDACTED]",
          "X-Trace": "snake-trace-id",
        },
        customHeaders: {
          Authorization: "[REDACTED]",
          "X-Trace": "trace-id",
        },
        input: {
          telegramBotToken: "[REDACTED]",
          url: "https://REDACTED:REDACTED@nested-api.example.com/v1",
          providerUrl: "https://REDACTED:REDACTED@nested-provider.example.com/",
          websiteUrl: "https://REDACTED:REDACTED@nested-web.example.com/",
          proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
          webhookUrl: "[REDACTED]",
          customHeaders: {
            "X-Webhook-Secret": "[REDACTED]",
            "X-Trace": "nested-trace",
          },
        },
        circuitBreakerWebhook: "[REDACTED]",
      }),
    });
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("sk-provider-secret");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("upstream-secret");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("main-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("provider-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("web-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("proxy-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("snake-proxy-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("snake-web-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("snake-mcp-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("snake-upstream-secret");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("telegram-secret-token");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("nested-main-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("nested-provider-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("nested-web-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("nested-pass");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("shared-secret");
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain("alert-secret");
    debugSpy.mockRestore();
  });
});

describe("Action Adapter：辅助导出函数（单元测试）", () => {
  test("createActionRoutes：应批量生成 route/handler", () => {
    const routes = createActionRoutes(
      "demo",
      {
        a: async () => ({ ok: true, data: 1 }),
        b: async () => 2,
      },
      {
        b: { requiresAuth: false },
      }
    );

    expect(routes).toHaveLength(2);
  });

  test("通用 schemas：应支持解析与默认值", () => {
    const schema = createParamSchema({ name: z.string() });
    expect(schema.parse({ name: "x" })).toEqual({ name: "x" });

    expect(IdParamSchema.parse({ id: 1 })).toEqual({ id: 1 });
    expect(PaginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(SortSchema.parse({})).toEqual({ sortBy: undefined, sortOrder: "desc" });
  });
});
