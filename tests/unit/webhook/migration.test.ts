import { describe, expect, test, vi } from "vitest";

const createWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const updateBindingsActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/webhook-targets", () => {
  return {
    createWebhookTargetAction: createWebhookTargetActionMock,
  };
});

vi.mock("@/actions/notification-bindings", () => {
  return {
    updateBindingsAction: updateBindingsActionMock,
  };
});

describe("migrateToNewWebhookSystem - 异常计数返回", () => {
  test("发生异常时，应返回已完成的 createdTargets/createdBindings", async () => {
    createWebhookTargetActionMock
      .mockResolvedValueOnce({ ok: true, data: { id: 1 } })
      .mockRejectedValueOnce(new Error("boom"));

    const { migrateToNewWebhookSystem } = await import("@/lib/webhook/migration");

    const settings = {
      useLegacyMode: true,
      circuitBreakerEnabled: true,
      circuitBreakerWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
      dailyLeaderboardEnabled: true,
      dailyLeaderboardWebhook: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
      costAlertEnabled: false,
      costAlertWebhook: null,
    } as any;

    const result = await migrateToNewWebhookSystem(settings, new Map());

    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(result.createdTargets).toBe(1);
    expect(result.createdBindings).toBe(0);
  });
});
