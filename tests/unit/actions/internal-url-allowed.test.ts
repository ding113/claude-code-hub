import { describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn(async () => ({ user: { role: "admin" } }));
const webhookSendMock = vi.fn(async () => ({ success: true as const }));
const createWebhookTargetMock = vi.fn(async (input: any) => ({ id: 1, ...input }));

vi.mock("@/lib/auth", () => {
  return {
    getSession: getSessionMock,
  };
});

vi.mock("@/lib/webhook", () => {
  return {
    WebhookNotifier: class {
      send = webhookSendMock;
    },
  };
});

vi.mock("@/repository/notifications", () => {
  return {
    getNotificationSettings: vi.fn(async () => ({ useLegacyMode: false })),
    updateNotificationSettings: vi.fn(async () => ({})),
  };
});

vi.mock("@/repository/webhook-targets", () => {
  return {
    createWebhookTarget: createWebhookTargetMock,
    deleteWebhookTarget: vi.fn(async () => {}),
    getAllWebhookTargets: vi.fn(async () => []),
    getWebhookTargetById: vi.fn(async () => null),
    updateTestResult: vi.fn(async () => {}),
    updateWebhookTarget: vi.fn(async () => ({})),
  };
});

describe("允许内网地址输入", () => {
  test("testWebhookAction 不阻止内网 URL", async () => {
    const { testWebhookAction } = await import("@/actions/notifications");
    const result = await testWebhookAction("http://127.0.0.1:8080/webhook", "cost-alert");

    expect(result.success).toBe(true);
    expect(webhookSendMock).toHaveBeenCalledTimes(1);
  });

  test("testWebhookAction 非管理员应被拒绝", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { role: "user" } });

    const { testWebhookAction } = await import("@/actions/notifications");
    const result = await testWebhookAction("http://127.0.0.1:8080/webhook", "cost-alert");

    expect(result.success).toBe(false);
    expect(result.error).toBe("无权限执行此操作");
    expect(webhookSendMock).not.toHaveBeenCalled();
  });

  test("createWebhookTargetAction 允许内网 webhookUrl", async () => {
    const { createWebhookTargetAction } = await import("@/actions/webhook-targets");
    const internalUrl = "http://127.0.0.1:8080/webhook";

    const result = await createWebhookTargetAction({
      name: "test-target",
      providerType: "wechat",
      webhookUrl: internalUrl,
      isEnabled: true,
    });

    expect(result.ok).toBe(true);
    expect(createWebhookTargetMock).toHaveBeenCalledTimes(1);
    expect(createWebhookTargetMock.mock.calls[0]?.[0]?.webhookUrl).toBe(internalUrl);
  });
});
