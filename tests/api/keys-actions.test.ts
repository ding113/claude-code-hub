/**
 * API Key 管理模块 API 测试
 *
 * ⚠️ 状态：待重构为集成测试
 * 详见：tests/DIAGNOSIS-FINAL.md
 *
 * ---
 *
 * 测试范围：
 * - getKeys() - 获取 Key 列表
 * - addKey() - 创建 Key
 * - editKey() - 编辑 Key
 * - removeKey() - 删除 Key
 * - getKeysWithStatistics() - 获取 Key 统计信息
 * - getKeyLimitUsage() - 获取 Key 限额使用情况
 *
 * 测试场景：
 * - CRUD 操作
 * - 权限控制（用户只能管理自己的 Key）
 * - Key 限额验证（不能超过用户限额）
 * - 供应商分组验证
 * - 错误处理
 */

import { beforeEach, describe, expect, test } from "vitest";
import { callActionsRoute } from "../test-utils";

const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN || "test-admin-token";
const USER_TOKEN = "test-user-token";

// 辅助函数：调用 Key 管理 API
async function callKeysApi(
  action: string,
  body: Record<string, unknown> = {},
  authToken = ADMIN_TOKEN
) {
  const { response, json } = await callActionsRoute({
    method: "POST",
    pathname: `/api/actions/keys/${action}`,
    authToken,
    body,
  });
  return { response, data: json as any };
}

// 辅助函数：调用用户管理 API
async function callUsersApi(
  action: string,
  body: Record<string, unknown> = {},
  authToken = ADMIN_TOKEN
) {
  const { response, json } = await callActionsRoute({
    method: "POST",
    pathname: `/api/actions/users/${action}`,
    authToken,
    body,
  });
  return { response, data: json as any };
}

// ⚠️ 跳过所有测试直到重构为集成测试
describe.skip("Key 管理 - API 测试（待重构）", () => {
  test("未登录应返回错误", async () => {
    const { response, data } = await callKeysApi("getKeys", { userId: 1 }, undefined);

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("未登录");
  });

  test("管理员应该可以查看任何用户的 Key", async () => {
    // 创建测试用户
    const { data: userData } = await callUsersApi("addUser", {
      name: `Key测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });

    const userId = userData.data?.user?.id;
    if (!userId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("getKeys", { userId });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  test("普通用户不能查看其他用户的 Key", async () => {
    const { response, data } = await callKeysApi("getKeys", { userId: 999 }, USER_TOKEN);

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });
});

describe.skip("Key 管理 - 创建 Key (addKey)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建测试用户
    const { data } = await callUsersApi("addUser", {
      name: `Key测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      limit5hUsd: 5,
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 50,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功创建 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `测试Key_${Date.now()}`,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.generatedKey).toMatch(/^sk-[a-f0-9]{32}$/);
    expect(data.data.name).toBeDefined();
  });

  test("非管理员不能给其他用户创建 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi(
      "addKey",
      {
        userId: testUserId,
        name: "测试Key",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("缺少必需参数应返回错误", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      // 缺少 name
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("创建同名 Key 应返回错误", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const keyName = `重复Key_${Date.now()}`;

    // 创建第一个 Key
    await callKeysApi("addKey", {
      userId: testUserId,
      name: keyName,
    });

    // 尝试创建同名 Key
    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: keyName,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("已存在");
  });

  test("创建带过期时间的 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `过期Key_${Date.now()}`,
      expiresAt: futureDate.toISOString().split("T")[0],
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("创建带限额的 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `限额Key_${Date.now()}`,
      limit5hUsd: 2,
      limitDailyUsd: 5,
      limitWeeklyUsd: 10,
      limitMonthlyUsd: 20,
      limitConcurrentSessions: 2,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("Key 限额超过用户限额应返回错误", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `超限Key_${Date.now()}`,
      limit5hUsd: 100, // 超过用户的 5 USD 限额
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("不能超过用户限额");
  });

  test("创建带 Web UI 登录权限的 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `WebUI_Key_${Date.now()}`,
      canLoginWebUi: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("创建带供应商分组的 Key", async () => {
    // 先创建带供应商分组的用户
    const { data: userData } = await callUsersApi("addUser", {
      name: `分组用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      providerGroup: "group1,group2",
    });

    const userId = userData.data?.user?.id;
    if (!userId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId,
      name: `分组Key_${Date.now()}`,
      providerGroup: "group1",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("Key 供应商分组超出用户分组应返回错误", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `无效分组Key_${Date.now()}`,
      providerGroup: "invalid-group",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("创建带缓存策略的 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `缓存Key_${Date.now()}`,
      cacheTtlPreference: "5m",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("创建带滚动日限额的 Key", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `滚动限额Key_${Date.now()}`,
      limitDailyUsd: 5,
      dailyResetMode: "rolling",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });
});

describe.skip("Key 管理 - 编辑 Key (editKey)", () => {
  let testUserId: number;
  let testKeyId: number;

  beforeEach(async () => {
    // 创建测试用户
    const { data: userData } = await callUsersApi("addUser", {
      name: `Key测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      limit5hUsd: 10,
    });
    testUserId = userData.data?.user?.id;

    if (!testUserId) {
      return;
    }

    // 创建测试 Key
    const { data: _keyData } = await callKeysApi("addKey", {
      userId: testUserId,
      name: `待编辑Key_${Date.now()}`,
    });

    // 获取 Key ID
    const keysResponse = await callKeysApi("getKeys", { userId: testUserId });
    testKeyId = keysResponse.data.data?.[0]?.id;
  });

  test("应该成功编辑 Key", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi("editKey", {
      keyId: testKeyId,
      name: "已修改的Key名称",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能编辑其他用户的 Key", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi(
      "editKey",
      {
        keyId: testKeyId,
        name: "尝试修改",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("更新 Key 限额", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi("editKey", {
      keyId: testKeyId,
      name: "测试Key",
      limit5hUsd: 5,
      limitDailyUsd: 8,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("更新 Key 过期时间", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);

    const { response, data } = await callKeysApi("editKey", {
      keyId: testKeyId,
      name: "测试Key",
      expiresAt: futureDate.toISOString().split("T")[0],
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("编辑不存在的 Key 应返回错误", async () => {
    const { response, data } = await callKeysApi("editKey", {
      keyId: 999999,
      name: "不存在的Key",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("密钥不存在");
  });
});

describe.skip("Key 管理 - 删除 Key (removeKey)", () => {
  let testUserId: number;
  let testKeyId: number;

  beforeEach(async () => {
    // 创建测试用户（会自动创建一个默认 Key）
    const { data: userData } = await callUsersApi("addUser", {
      name: `Key测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });
    testUserId = userData.data?.user?.id;

    if (!testUserId) {
      return;
    }

    // 创建第二个 Key（确保用户有多个 Key）
    await callKeysApi("addKey", {
      userId: testUserId,
      name: `待删除Key_${Date.now()}`,
    });

    // 获取第二个 Key 的 ID
    const keysResponse = await callKeysApi("getKeys", { userId: testUserId });
    testKeyId = keysResponse.data.data?.[1]?.id;
  });

  test("应该成功删除 Key", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi("removeKey", {
      keyId: testKeyId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能删除其他用户的 Key", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi(
      "removeKey",
      {
        keyId: testKeyId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("删除用户最后一个 Key 应返回错误", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    // 获取所有 Key
    const keysResponse = await callKeysApi("getKeys", { userId: testUserId });
    const keys = keysResponse.data.data || [];

    // 删除所有 Key 直到只剩一个
    for (let i = 0; i < keys.length - 1; i++) {
      await callKeysApi("removeKey", { keyId: keys[i].id });
    }

    // 尝试删除最后一个 Key
    const lastKeyId = keys[keys.length - 1].id;
    const { response, data } = await callKeysApi("removeKey", {
      keyId: lastKeyId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("至少需要保留一个");
  });

  test("删除不存在的 Key 应返回错误", async () => {
    const { response, data } = await callKeysApi("removeKey", {
      keyId: 999999,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("密钥不存在");
  });
});

describe.skip("Key 管理 - 获取 Key 统计信息 (getKeysWithStatistics)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建测试用户
    const { data } = await callUsersApi("addUser", {
      name: `统计测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功获取 Key 统计信息", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("getKeysWithStatistics", {
      userId: testUserId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  test("非管理员不能获取其他用户的统计", async () => {
    if (!testUserId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi(
      "getKeysWithStatistics",
      {
        userId: testUserId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });
});

describe.skip("Key 管理 - 获取 Key 限额使用情况 (getKeyLimitUsage)", () => {
  let testUserId: number;
  let testKeyId: number;

  beforeEach(async () => {
    // 创建带限额的测试用户
    const { data: userData } = await callUsersApi("addUser", {
      name: `限额测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      limit5hUsd: 10,
      limitWeeklyUsd: 50,
      limitMonthlyUsd: 200,
    });
    testUserId = userData.data?.user?.id;

    if (!testUserId) {
      return;
    }

    // 获取默认 Key
    const keysResponse = await callKeysApi("getKeys", { userId: testUserId });
    testKeyId = keysResponse.data.data?.[0]?.id;
  });

  test("应该成功获取 Key 限额使用情况", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi("getKeyLimitUsage", {
      keyId: testKeyId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.cost5h).toBeDefined();
    expect(data.data.costDaily).toBeDefined();
    expect(data.data.costWeekly).toBeDefined();
    expect(data.data.costMonthly).toBeDefined();
    expect(data.data.costTotal).toBeDefined();
    expect(data.data.concurrentSessions).toBeDefined();
  });

  test("非管理员不能查看其他用户 Key 的限额", async () => {
    if (!testKeyId) {
      console.log("跳过测试：无法创建测试 Key");
      return;
    }

    const { response, data } = await callKeysApi(
      "getKeyLimitUsage",
      {
        keyId: testKeyId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("查询不存在的 Key 应返回错误", async () => {
    const { response, data } = await callKeysApi("getKeyLimitUsage", {
      keyId: 999999,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("密钥不存在");
  });
});

describe.skip("Key 管理 - 响应格式验证", () => {
  test("所有成功响应应符合 ActionResult 格式", async () => {
    // 创建测试用户
    const { data: userData } = await callUsersApi("addUser", {
      name: `格式测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });

    const userId = userData.data?.user?.id;
    if (!userId) {
      console.log("跳过测试：无法创建测试用户");
      return;
    }

    const { response, data } = await callKeysApi("getKeys", { userId });

    expect(response.ok).toBe(true);
    expect(data).toHaveProperty("ok");
    expect(data.ok).toBe(true);
    expect(data).toHaveProperty("data");
  });

  test("所有错误响应应符合 ActionResult 格式", async () => {
    const { response, data } = await callKeysApi("getKeys", { userId: 1 }, USER_TOKEN);

    expect(response.ok).toBe(true);
    expect(data).toHaveProperty("ok");
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
  });
});
