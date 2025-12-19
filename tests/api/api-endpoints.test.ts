/**
 * API 端点 HTTP 集成测试
 *
 * 目的:
 * - 测试 OpenAPI 端点的 HTTP 请求/响应
 * - 验证认证、权限、参数验证
 * - 测试错误处理和边界条件
 *
 * 用法:
 *   bun run test:api
 *
 * 默认模式（推荐）:
 *   进程内调用 Next Route Handler，无需启动开发服务器
 *
 * E2E 模式（可选）:
 *   设置 API_E2E_BASE_URL 后，将改为真实 HTTP 访问（需要先启动服务与依赖）
 *   例如：API_E2E_BASE_URL=http://localhost:13500/api/actions
 */

import { describe, expect, test } from "vitest";
import { callActionsRoute } from "../test-utils";

const E2E_API_BASE_URL = process.env.API_E2E_BASE_URL || "";
const API_BASE_URL = E2E_API_BASE_URL || "http://localhost:13500/api/actions";

// 辅助函数：发送 API 请求
async function callApi(
  module: string,
  action: string,
  body: Record<string, unknown> = {},
  options: { authToken?: string } = {}
) {
  // 默认走进程内调用（稳定、无需启动服务器），仅当设置 API_E2E_BASE_URL 时才走真实 HTTP
  if (!E2E_API_BASE_URL) {
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: `/api/actions/${module}/${action}`,
      authToken: options.authToken,
      body,
    });
    return { response, data: json as any };
  }

  const response = await fetch(`${API_BASE_URL}/${module}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authToken && { Cookie: `auth-token=${options.authToken}` }),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { response, data };
}

describe("API 认证测试", () => {
  test("缺少 auth-token 应该返回 401", async () => {
    const { response, data } = await callApi("users", "getUsers");

    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("未认证");
  });

  test("无效的 auth-token 应该返回 401", async () => {
    // 该断言依赖数据库可用（validateKey 会查询 keys/users），因此仅在 E2E 模式运行
    if (!E2E_API_BASE_URL) {
      console.log("⚠️  跳过无效 token 测试（需要 API_E2E_BASE_URL + 可用数据库）");
      return;
    }
    const { response, data } = await callApi(
      "users",
      "getUsers",
      {},
      { authToken: "invalid-token" }
    );

    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("认证无效");
  });
});

describe("API 参数验证测试", () => {
  test("缺少必需参数应该返回 400 或 500", async () => {
    if (!E2E_API_BASE_URL) {
      console.log("⚠️  跳过参数验证测试（需要 API_E2E_BASE_URL + 可用数据库/认证）");
      return;
    }
    // 模拟登录后的 token（实际使用时需要真实 token）
    const mockToken = "test-token";

    const { response } = await callApi(
      "users",
      "editUser",
      {
        // 缺少 userId 参数
        name: "Test User",
      },
      { authToken: mockToken }
    );

    // 参数验证失败应该返回错误
    expect([400, 401, 500]).toContain(response.status);
  });

  test("无效参数类型应该返回 400 或 500", async () => {
    if (!E2E_API_BASE_URL) {
      console.log("⚠️  跳过参数验证测试（需要 API_E2E_BASE_URL + 可用数据库/认证）");
      return;
    }
    const mockToken = "test-token";

    const { response } = await callApi(
      "keys",
      "getKeys",
      {
        userId: "not-a-number", // 应该是 number
      },
      { authToken: mockToken }
    );

    expect([400, 401, 500]).toContain(response.status);
  });
});

describe("API 响应格式测试", () => {
  test("所有成功响应应该符合 {ok: true, data: ...} 格式", async () => {
    // 这个测试需要真实的认证 token
    // 此处仅作示例，实际运行需要有效 session
    const mockToken = process.env.TEST_AUTH_TOKEN || "skip";

    if (mockToken === "skip") {
      console.log("⚠️  跳过响应格式测试（需要设置 TEST_AUTH_TOKEN 环境变量）");
      return;
    }

    const { response, data } = await callApi(
      "overview",
      "getOverviewData",
      {},
      { authToken: mockToken }
    );

    if (response.ok) {
      expect(data).toHaveProperty("ok");
      expect(data.ok).toBe(true);
      expect(data).toHaveProperty("data");
    }
  });

  test("所有错误响应应该符合 {ok: false, error: ...} 格式", async () => {
    const { data } = await callApi("users", "getUsers"); // 无 auth

    expect(data).toHaveProperty("ok");
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
  });
});

describe("API 端点可达性测试", () => {
  const criticalEndpoints = [
    // 用户管理
    { module: "users", action: "getUsers" },
    { module: "users", action: "addUser" },
    { module: "users", action: "editUser" },
    { module: "users", action: "removeUser" },

    // 密钥管理
    { module: "keys", action: "getKeys" },
    { module: "keys", action: "addKey" },

    // 供应商管理
    { module: "providers", action: "getProviders" },
    { module: "providers", action: "addProvider" },
    { module: "providers", action: "getProvidersHealthStatus" },

    // 统计与日志
    { module: "statistics", action: "getUserStatistics" },
    { module: "usage-logs", action: "getUsageLogs" },
    { module: "overview", action: "getOverviewData" },

    // Session 管理
    { module: "active-sessions", action: "getActiveSessions" },
  ];

  test("所有关键端点应该可访问（即使认证失败）", async () => {
    const results = await Promise.all(
      criticalEndpoints.map(async ({ module, action }) => {
        try {
          const response = !E2E_API_BASE_URL
            ? (
                await callActionsRoute({
                  method: "POST",
                  pathname: `/api/actions/${module}/${action}`,
                  body: {},
                })
              ).response
            : await fetch(`${API_BASE_URL}/${module}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });

          return {
            endpoint: `${module}/${action}`,
            status: response.status,
            reachable: response.status !== 404,
          };
        } catch (error) {
          return {
            endpoint: `${module}/${action}`,
            status: 0,
            reachable: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    // 所有端点都应该返回非 404 状态（401 或其他都可以）
    const unreachable = results.filter((r) => !r.reachable);
    expect(unreachable).toEqual([]);
  });
});

describe("API 文档 UI 可访问性", () => {
  test("Scalar UI 应该可访问", async () => {
    const response = !E2E_API_BASE_URL
      ? (await callActionsRoute({ method: "GET", pathname: "/api/actions/scalar" })).response
      : await fetch(`${API_BASE_URL}/scalar`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("Swagger UI 应该可访问", async () => {
    const response = !E2E_API_BASE_URL
      ? (await callActionsRoute({ method: "GET", pathname: "/api/actions/docs" })).response
      : await fetch(`${API_BASE_URL}/docs`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("健康检查端点应该正常", async () => {
    if (!E2E_API_BASE_URL) {
      // 进程内调用模式
      const { response, json } = await callActionsRoute({
        method: "GET",
        pathname: "/api/actions/health",
      });
      expect(response.ok).toBe(true);
      expect(json).toBeDefined();
      expect((json as any).status).toBe("ok");
      expect((json as any).timestamp).toBeDefined();
      expect((json as any).version).toBeDefined();
    } else {
      // E2E HTTP 调用模式
      const response = await fetch(`${API_BASE_URL}/health`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeDefined();
      expect(data.version).toBeDefined();
    }
  });
});
