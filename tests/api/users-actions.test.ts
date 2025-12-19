/**
 * 用户管理模块 API 测试
 *
 * ⚠️ 状态：待重构为集成测试
 *
 * 当前问题：
 * - 这些测试试图在单元测试环境中运行需要完整 Next.js 运行时的 Server Actions
 * - Server Actions 使用了 cookies()、getTranslations()、revalidatePath() 等 Next.js 特定 API
 * - 这些 API 需要 Next.js 的请求上下文（AsyncLocalStorage），在 Vitest 环境无法提供
 *
 * 解决方案：
 * - 方案 A（推荐）：重写为集成测试 - 启动真实的 Next.js 服务器，通过 HTTP 请求测试
 * - 方案 B：单元测试 Repository 层 - 只测试不依赖 Next.js 运行时的纯业务逻辑
 *
 * 详见：tests/DIAGNOSIS-FINAL.md
 *
 * ---
 *
 * 测试范围：
 * - getUsers() - 获取用户列表
 * - addUser() - 创建用户
 * - editUser() - 编辑用户
 * - removeUser() - 删除用户
 * - toggleUserEnabled() - 启用/禁用用户
 * - renewUser() - 续期用户
 * - getUserLimitUsage() - 获取用户限额使用情况
 *
 * 测试场景：
 * - 正常场景（CRUD 操作）
 * - 参数验证（边界值、非法值）
 * - 权限控制（管理员 vs 普通用户）
 * - 错误处理
 */

import { beforeEach, describe, expect, test } from "vitest";
import { callActionsRoute } from "../test-utils";

// 测试用管理员 Token（实际使用时需要有效的 token）
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN || "test-admin-token";
const USER_TOKEN = "test-user-token";

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
describe.skip("用户管理 - API 测试（待重构）", () => {
  test("未登录应返回空数组", async () => {
    const { response, data } = await callUsersApi("getUsers", {}, undefined);
    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test("管理员应该可以查看所有用户", async () => {
    const { response, data } = await callUsersApi("getUsers");
    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  test("普通用户只能看到自己", async () => {
    const { response, data } = await callUsersApi("getUsers", {}, USER_TOKEN);
    expect(response.ok).toBe(true);
    // 由于测试环境的 USER_TOKEN 无法查询到真实用户，此处会返回空数组
    expect(Array.isArray(data)).toBe(true);
  });
});

describe.skip("用户管理 - 创建用户 (addUser)", () => {
  test("应该成功创建用户", async () => {
    const { response, data } = await callUsersApi("addUser", {
      name: `测试用户_${Date.now()}`,
      note: "API 测试创建的用户",
      rpm: 60,
      dailyQuota: 10,
      isEnabled: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.user).toBeDefined();
    expect(data.data.defaultKey).toBeDefined();
    expect(data.data.defaultKey.key).toMatch(/^sk-[a-f0-9]{32}$/);
  });

  test("非管理员不能创建用户", async () => {
    const { response, data } = await callUsersApi(
      "addUser",
      {
        name: "测试用户",
        rpm: 60,
        dailyQuota: 10,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("缺少必需参数应返回错误", async () => {
    const { response, data } = await callUsersApi("addUser", {
      // 缺少 name
      rpm: 60,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("参数类型错误应返回验证失败", async () => {
    const { response, data } = await callUsersApi("addUser", {
      name: "测试用户",
      rpm: "not-a-number", // 应该是 number
      dailyQuota: 10,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("RPM 超出范围应返回验证失败", async () => {
    const { response, data } = await callUsersApi("addUser", {
      name: "测试用户",
      rpm: -1, // 应该 >= 1
      dailyQuota: 10,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("日限额超出范围应返回验证失败", async () => {
    const { response, data } = await callUsersApi("addUser", {
      name: "测试用户",
      rpm: 60,
      dailyQuota: -1, // 日限额不能为负数（0 表示无限制）
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("创建带过期时间的用户", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 天后过期

    const { response, data } = await callUsersApi("addUser", {
      name: `测试用户_过期_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      expiresAt: futureDate,
      isEnabled: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data.user.expiresAt).toBeDefined();
  });

  test("创建带限额的用户", async () => {
    const { response, data } = await callUsersApi("addUser", {
      name: `测试用户_限额_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      limit5hUsd: 5,
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 50,
      limitConcurrentSessions: 3,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data.user.limit5hUsd).toBe(5);
    expect(data.data.user.limitWeeklyUsd).toBe(20);
    expect(data.data.user.limitMonthlyUsd).toBe(50);
    expect(data.data.user.limitConcurrentSessions).toBe(3);
  });
});

describe.skip("用户管理 - 编辑用户 (editUser)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建测试用户
    const { data } = await callUsersApi("addUser", {
      name: `待编辑用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功编辑用户", async () => {
    const { response, data } = await callUsersApi("editUser", {
      userId: testUserId,
      name: "已修改的用户名",
      rpm: 120,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能编辑其他用户", async () => {
    const { response, data } = await callUsersApi(
      "editUser",
      {
        userId: testUserId,
        name: "尝试修改",
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("编辑不存在的用户应返回错误", async () => {
    const { response, data } = await callUsersApi("editUser", {
      userId: 999999,
      name: "不存在的用户",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
  });

  test("更新用户限额", async () => {
    const { response, data } = await callUsersApi("editUser", {
      userId: testUserId,
      limit5hUsd: 10,
      limitWeeklyUsd: 30,
      limitMonthlyUsd: 100,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("更新用户标签", async () => {
    const { response, data } = await callUsersApi("editUser", {
      userId: testUserId,
      tags: ["测试", "开发"],
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("更新用户供应商分组", async () => {
    const { response, data } = await callUsersApi("editUser", {
      userId: testUserId,
      providerGroup: "group1,group2",
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });
});

describe.skip("用户管理 - 删除用户 (removeUser)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建待删除用户
    const { data } = await callUsersApi("addUser", {
      name: `待删除用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功删除用户", async () => {
    const { response, data } = await callUsersApi("removeUser", {
      userId: testUserId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能删除用户", async () => {
    const { response, data } = await callUsersApi(
      "removeUser",
      {
        userId: testUserId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("删除不存在的用户应返回错误", async () => {
    const { response, data } = await callUsersApi("removeUser", {
      userId: 999999,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
  });
});

describe.skip("用户管理 - 启用/禁用用户 (toggleUserEnabled)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建测试用户
    const { data } = await callUsersApi("addUser", {
      name: `待切换状态用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      isEnabled: true,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功禁用用户", async () => {
    const { response, data } = await callUsersApi("toggleUserEnabled", {
      userId: testUserId,
      enabled: false,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("应该成功启用用户", async () => {
    const { response, data } = await callUsersApi("toggleUserEnabled", {
      userId: testUserId,
      enabled: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能切换用户状态", async () => {
    const { response, data } = await callUsersApi(
      "toggleUserEnabled",
      {
        userId: testUserId,
        enabled: false,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("参数类型错误应返回失败", async () => {
    const { response, data } = await callUsersApi("toggleUserEnabled", {
      userId: testUserId,
      enabled: "not-a-boolean", // 应该是 boolean
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
  });
});

describe.skip("用户管理 - 续期用户 (renewUser)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建带过期时间的测试用户
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const { data } = await callUsersApi("addUser", {
      name: `待续期用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      expiresAt: futureDate,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功续期用户", async () => {
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    const { response, data } = await callUsersApi("renewUser", {
      userId: testUserId,
      expiresAt: newExpiresAt.toISOString(),
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("续期时启用用户", async () => {
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    const { response, data } = await callUsersApi("renewUser", {
      userId: testUserId,
      expiresAt: newExpiresAt.toISOString(),
      enableUser: true,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
  });

  test("非管理员不能续期用户", async () => {
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    const { response, data } = await callUsersApi(
      "renewUser",
      {
        userId: testUserId,
        expiresAt: newExpiresAt.toISOString(),
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("过期时间为过去应返回错误", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const { response, data } = await callUsersApi("renewUser", {
      userId: testUserId,
      expiresAt: pastDate.toISOString(),
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  test("过期时间超过 10 年应返回错误", async () => {
    const farFutureDate = new Date();
    farFutureDate.setFullYear(farFutureDate.getFullYear() + 11);

    const { response, data } = await callUsersApi("renewUser", {
      userId: testUserId,
      expiresAt: farFutureDate.toISOString(),
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });
});

describe.skip("用户管理 - 获取用户限额使用情况 (getUserLimitUsage)", () => {
  let testUserId: number;

  beforeEach(async () => {
    // 创建带限额的测试用户
    const { data } = await callUsersApi("addUser", {
      name: `限额测试用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
      limit5hUsd: 5,
      limitWeeklyUsd: 20,
      limitMonthlyUsd: 50,
    });
    testUserId = data.data?.user?.id;
  });

  test("应该成功获取用户限额使用情况", async () => {
    const { response, data } = await callUsersApi("getUserLimitUsage", {
      userId: testUserId,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.rpm).toBeDefined();
    expect(data.data.dailyCost).toBeDefined();
    expect(data.data.rpm.limit).toBe(60);
    expect(data.data.dailyCost.limit).toBe(10);
  });

  test("非管理员不能查看其他用户的限额", async () => {
    const { response, data } = await callUsersApi(
      "getUserLimitUsage",
      {
        userId: testUserId,
      },
      USER_TOKEN
    );

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("无权限");
  });

  test("查询不存在的用户应返回错误", async () => {
    const { response, data } = await callUsersApi("getUserLimitUsage", {
      userId: 999999,
    });

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });
});

describe.skip("用户管理 - 响应格式验证", () => {
  test("所有成功响应应符合 ActionResult 格式", async () => {
    const { response, data } = await callUsersApi("addUser", {
      name: `格式验证用户_${Date.now()}`,
      rpm: 60,
      dailyQuota: 10,
    });

    expect(response.ok).toBe(true);
    expect(data).toHaveProperty("ok");
    expect(data.ok).toBe(true);
    expect(data).toHaveProperty("data");
  });

  test("所有错误响应应符合 ActionResult 格式", async () => {
    const { response, data } = await callUsersApi(
      "addUser",
      {
        name: "测试用户",
        rpm: 60,
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
