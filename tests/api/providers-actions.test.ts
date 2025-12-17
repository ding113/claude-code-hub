/**
 * 供应商管理模块 API 测试
 *
 * ⚠️ 状态：待重构为集成测试
 * 详见：tests/DIAGNOSIS-FINAL.md
 *
 * ---
 *
 * 测试范围：
 * - getProviders() - 获取供应商列表
 * - addProvider() - 添加供应商
 * - editProvider() - 编辑供应商
 * - removeProvider() - 删除供应商
 * - getProvidersHealthStatus() - 获取熔断器健康状态
 * - resetProviderCircuit() - 重置熔断器
 * - getProviderLimitUsage() - 获取供应商限额使用情况
 * - testProviderProxy() - 测试代理连接
 * - getUnmaskedProviderKey() - 获取完整密钥
 *
 * 测试场景：
 * - CRUD 操作
 * - 权重和优先级验证
 * - 代理配置验证
 * - 熔断器状态管理
 */

import { beforeEach, describe, expect, test } from "vitest";
import { callActionsRoute } from "../test-utils";

const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN || "test-admin-token";
const USER_TOKEN = "test-user-token";

// 辅助函数：调用供应商管理 API
async function callProvidersApi(
  action: string,
  body: Record<string, unknown> = {},
  authToken = ADMIN_TOKEN
) {
  const { response, json } = await callActionsRoute({
    method: "POST",
    pathname: `/api/actions/providers/${action}`,
    authToken,
    body,
  });
  return { response, data: json as any };
}

// ⚠️ 跳过所有测试直到重构为集成测试
describe.skip("供应商管理 - API 测试（待重构）", () => {
  test("未登录应返回空数组", async () => {
    const { response, data } = await callProvidersApi("getProviders", {}, undefined);
    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test("管理员应该可以查看所有供应商", async () => {
    const { response, data } = await callProvidersApi("getProviders");
    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  test("普通用户不能查看供应商列表", async () => {
    const { response, data } = await callProvidersApi("getProviders", {}, USER_TOKEN);
    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });
});

describe.skip("供应商管理 - 添加供应商 (addProvider)", () => {
  test("应该成功添加 Claude 供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_Claude_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key-123456",
      provider_type: "claude",
      is_enabled: true,
      weight: 100,
      priority: 1,
      cost_multiplier: 1.0,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("应该成功添加 Codex 供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_Codex_${Date.now()}`,
      url: "https://api.openai.com",
      key: "sk-test-key-codex",
      provider_type: "codex",
      is_enabled: true,
      weight: 50,
      priority: 2,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能添加供应商", async () => {
    const { response, data } = await callProvidersApi(
      "addProvider",
      {
        name: "测试供应商",
        url: "https://api.example.com",
        key: "sk-test",
        provider_type: "claude",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("缺少必需参数应返回错误", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: "测试供应商",
      // 缺少 url 和 key
      provider_type: "claude",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("权重超出范围应返回验证失败", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: "测试供应商",
      url: "https://api.example.com",
      key: "sk-test",
      provider_type: "claude",
      weight: -1, // 应该 >= 0
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("优先级超出范围应返回验证失败", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: "测试供应商",
      url: "https://api.example.com",
      key: "sk-test",
      provider_type: "claude",
      priority: 0, // 应该 >= 1
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("添加带代理的供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_代理_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      proxy_url: "http://proxy.example.com:8080",
      proxy_fallback_to_direct: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("无效代理 URL 格式应返回错误", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: "测试供应商",
      url: "https://api.anthropic.com",
      key: "sk-test",
      provider_type: "claude",
      proxy_url: "invalid-proxy-url", // 无效格式
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("代理地址格式无效");
  });

  test("添加带限额的供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_限额_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      limit_5h_usd: 10,
      limit_daily_usd: 50,
      limit_weekly_usd: 200,
      limit_monthly_usd: 500,
      limit_concurrent_sessions: 5,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("添加带熔断器配置的供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_熔断器_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      circuit_breaker_failure_threshold: 3,
      circuit_breaker_open_duration: 60000,
      circuit_breaker_half_open_success_threshold: 2,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("添加带模型重定向的供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_重定向_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      model_redirects: {
        "claude-3-opus": "claude-3-sonnet",
        "gpt-4": "claude-3-opus",
      },
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("添加带分组标签的供应商", async () => {
    const { response, data } = await callProvidersApi("addProvider", {
      name: `测试供应商_分组_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      group_tag: "production",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });
});

describe.skip("供应商管理 - 编辑供应商 (editProvider)", () => {
  let testProviderId: number;

  beforeEach(async () => {
    // 创建测试供应商
    const { data: _data } = await callProvidersApi("addProvider", {
      name: `待编辑供应商_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      weight: 100,
      priority: 1,
    });

    // 获取创建的供应商 ID
    const providers = await callProvidersApi("getProviders");
    const createdProvider = providers.data.find(
      (p: any) => p.name === `待编辑供应商_${Date.now()}`
    );
    testProviderId = createdProvider?.id;
  });

  test("应该成功编辑供应商", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("editProvider", {
      providerId: testProviderId,
      name: "已修改的供应商名",
      weight: 200,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能编辑供应商", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi(
      "editProvider",
      {
        providerId: testProviderId,
        name: "尝试修改",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("更新供应商权重", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("editProvider", {
      providerId: testProviderId,
      weight: 150,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("更新供应商优先级", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("editProvider", {
      providerId: testProviderId,
      priority: 5,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("更新供应商代理配置", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("editProvider", {
      providerId: testProviderId,
      proxy_url: "http://proxy.example.com:3128",
      proxy_fallback_to_direct: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("更新供应商限额", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("editProvider", {
      providerId: testProviderId,
      limit_5h_usd: 20,
      limit_daily_usd: 100,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });
});

describe.skip("供应商管理 - 删除供应商 (removeProvider)", () => {
  let testProviderId: number;

  beforeEach(async () => {
    // 创建待删除供应商
    await callProvidersApi("addProvider", {
      name: `待删除供应商_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
    });

    const providers = await callProvidersApi("getProviders");
    const createdProvider = providers.data.find((p: any) => p.name.startsWith("待删除供应商_"));
    testProviderId = createdProvider?.id;
  });

  test("应该成功删除供应商", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("removeProvider", {
      providerId: testProviderId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能删除供应商", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi(
      "removeProvider",
      {
        providerId: testProviderId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("删除不存在的供应商应返回错误", async () => {
    const { response, data } = await callProvidersApi("removeProvider", {
      providerId: 999999,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
  });
});

describe.skip("供应商管理 - 熔断器健康状态 (getProvidersHealthStatus)", () => {
  test("应该成功获取熔断器状态", async () => {
    const { response, data } = await callProvidersApi("getProvidersHealthStatus");

    expect(response.ok).toBe(true);
    expect(typeof data).toBe("object");
    // 熔断器状态应该是一个对象，键为供应商 ID
  });

  test("非管理员不能查看熔断器状态", async () => {
    const { response, data } = await callProvidersApi("getProvidersHealthStatus", {}, USER_TOKEN);

    expect(response.ok).toBe(true);
    expect(typeof data).toBe("object");
    expect(Object.keys(data).length).toBe(0);
  });
});

describe.skip("供应商管理 - 重置熔断器 (resetProviderCircuit)", () => {
  let testProviderId: number;

  beforeEach(async () => {
    // 创建测试供应商
    await callProvidersApi("addProvider", {
      name: `熔断器测试供应商_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
    });

    const providers = await callProvidersApi("getProviders");
    const createdProvider = providers.data.find((p: any) => p.name.startsWith("熔断器测试供应商_"));
    testProviderId = createdProvider?.id;
  });

  test("应该成功重置熔断器", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("resetProviderCircuit", {
      providerId: testProviderId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能重置熔断器", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi(
      "resetProviderCircuit",
      {
        providerId: testProviderId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });
});

describe.skip("供应商管理 - 获取供应商限额使用情况 (getProviderLimitUsage)", () => {
  let testProviderId: number;

  beforeEach(async () => {
    // 创建带限额的测试供应商
    await callProvidersApi("addProvider", {
      name: `限额测试供应商_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-key",
      provider_type: "claude",
      limit_5h_usd: 10,
      limit_daily_usd: 50,
      limit_weekly_usd: 200,
      limit_monthly_usd: 500,
    });

    const providers = await callProvidersApi("getProviders");
    const createdProvider = providers.data.find((p: any) => p.name.startsWith("限额测试供应商_"));
    testProviderId = createdProvider?.id;
  });

  test("应该成功获取供应商限额使用情况", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("getProviderLimitUsage", {
      providerId: testProviderId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.cost5h).toBeDefined();
    expect(data.data.costDaily).toBeDefined();
    expect(data.data.costWeekly).toBeDefined();
    expect(data.data.costMonthly).toBeDefined();
    expect(data.data.concurrentSessions).toBeDefined();
  });

  test("非管理员不能查看供应商限额", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi(
      "getProviderLimitUsage",
      {
        providerId: testProviderId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });
});

describe.skip("供应商管理 - 测试代理连接 (testProviderProxy)", () => {
  test("应该成功测试无代理连接", async () => {
    const { response, data } = await callProvidersApi("testProviderProxy", {
      providerUrl: "https://api.anthropic.com",
      proxyUrl: null,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.success).toBeDefined();
    expect(data.data.message).toBeDefined();
  });

  test("无效的代理 URL 应返回错误", async () => {
    const { response, data } = await callProvidersApi("testProviderProxy", {
      providerUrl: "https://api.anthropic.com",
      proxyUrl: "invalid-proxy",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data.success).toBe(false);
    expect(data.data.message).toContain("代理地址格式无效");
  });

  test("非管理员不能测试代理连接", async () => {
    const { response, data } = await callProvidersApi(
      "testProviderProxy",
      {
        providerUrl: "https://api.anthropic.com",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });
});

describe.skip("供应商管理 - 获取完整密钥 (getUnmaskedProviderKey)", () => {
  let testProviderId: number;

  beforeEach(async () => {
    // 创建测试供应商
    await callProvidersApi("addProvider", {
      name: `密钥测试供应商_${Date.now()}`,
      url: "https://api.anthropic.com",
      key: "sk-test-complete-key-123456",
      provider_type: "claude",
    });

    const providers = await callProvidersApi("getProviders");
    const createdProvider = providers.data.find((p: any) => p.name.startsWith("密钥测试供应商_"));
    testProviderId = createdProvider?.id;
  });

  test("管理员应该可以获取完整密钥", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi("getUnmaskedProviderKey", {
      id: testProviderId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.key).toBeDefined();
    expect(data.data.key).toMatch(/^sk-/);
  });

  test("非管理员不能获取完整密钥", async () => {
    if (!testProviderId) {
      console.log("跳过测试：无法创建测试供应商");
      return;
    }

    const { response, data } = await callProvidersApi(
      "getUnmaskedProviderKey",
      {
        id: testProviderId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("权限不足");
  });

  test("获取不存在的供应商密钥应返回错误", async () => {
    const { response, data } = await callProvidersApi("getUnmaskedProviderKey", {
      id: 999999,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("供应商不存在");
  });
});

describe.skip("供应商管理 - 响应格式验证", () => {
  test("所有成功响应应符合 ActionResult 格式", async () => {
    const { response, data } = await callProvidersApi("getProviders");

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  test("所有错误响应应符合 ActionResult 格式", async () => {
    const { response, data } = await callProvidersApi(
      "addProvider",
      {
        name: "测试供应商",
        url: "https://api.example.com",
        key: "sk-test",
        provider_type: "claude",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data).toHaveProperty("ok");
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
  });
});
