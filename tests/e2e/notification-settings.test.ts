/**
 * 通知设置（Webhook Targets / Bindings）E2E 测试
 *
 * 覆盖范围：
 * - 创建/更新/删除推送目标
 * - 绑定通知类型与目标
 * - 验证创建目标后自动退出 legacy 模式（useLegacyMode=false）
 *
 * 前提：
 * - 开发服务器运行在 http://localhost:13500
 * - 已配置 ADMIN_TOKEN（或 TEST_ADMIN_TOKEN）
 */

import { afterAll, describe, expect, test } from "vitest";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:13500/api/actions";
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN;

async function callApi(module: string, action: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${API_BASE_URL}/${module}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `auth-token=${ADMIN_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const data = await response.json();
    return { response, data };
  }

  const text = await response.text();
  return { response, data: { ok: false, error: `非JSON响应: ${text}` } };
}

async function expectOk(module: string, action: string, body: Record<string, unknown> = {}) {
  const { response, data } = await callApi(module, action, body);
  expect(response.ok).toBe(true);
  expect(data.ok).toBe(true);
  return data.data;
}

const testState = {
  targetIds: [] as number[],
};

afterAll(async () => {
  // 尽量清理测试数据（忽略失败）
  for (const id of testState.targetIds) {
    try {
      await callApi("webhook-targets", "deleteWebhookTargetAction", { id });
    } catch (_e) {
      // ignore
    }
  }
});

const run = ADMIN_TOKEN ? describe : describe.skip;

run("通知设置 - Webhook 目标与绑定（E2E）", () => {
  let targetId: number;

  test("1) 获取通知设置", async () => {
    const settings = await expectOk("notifications", "getNotificationSettingsAction");
    expect(settings).toBeDefined();
    expect(typeof settings.enabled).toBe("boolean");
  });

  test("2) 创建推送目标（custom）", async () => {
    const result = await expectOk("webhook-targets", "createWebhookTargetAction", {
      name: `E2E Webhook Target ${Date.now()}`,
      providerType: "custom",
      webhookUrl: "https://example.com/webhook",
      customTemplate: JSON.stringify({ text: "title={{title}}" }),
      customHeaders: { "X-Test": "1" },
      proxyUrl: null,
      proxyFallbackToDirect: false,
      isEnabled: true,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeTypeOf("number");
    expect(result.providerType).toBe("custom");
    targetId = result.id;
    testState.targetIds.push(targetId);
  });

  test("3) 创建目标后应处于新模式（useLegacyMode=false）", async () => {
    const settings = await expectOk("notifications", "getNotificationSettingsAction");
    expect(settings.useLegacyMode).toBe(false);
  });

  test("4) 支持局部更新目标配置", async () => {
    const updated = await expectOk("webhook-targets", "updateWebhookTargetAction", {
      id: targetId,
      input: { isEnabled: false },
    });

    expect(updated.id).toBe(targetId);
    expect(updated.isEnabled).toBe(false);
  });

  test("5) 绑定 daily_leaderboard -> target", async () => {
    await expectOk("notification-bindings", "updateBindingsAction", {
      type: "daily_leaderboard",
      bindings: [{ targetId, isEnabled: true }],
    });

    const bindings = await expectOk("notification-bindings", "getBindingsForTypeAction", {
      type: "daily_leaderboard",
    });

    expect(Array.isArray(bindings)).toBe(true);
    expect(bindings.length).toBe(1);
    expect(bindings[0].targetId).toBe(targetId);
    expect(bindings[0].target.id).toBe(targetId);
  });

  test("6) 删除目标应使绑定不可见", async () => {
    await expectOk("webhook-targets", "deleteWebhookTargetAction", { id: targetId });

    // 从清理列表移除，避免重复删除
    testState.targetIds = testState.targetIds.filter((id) => id !== targetId);

    const bindings = await expectOk("notification-bindings", "getBindingsForTypeAction", {
      type: "daily_leaderboard",
    });
    expect(Array.isArray(bindings)).toBe(true);
    expect(bindings.length).toBe(0);
  });
});
