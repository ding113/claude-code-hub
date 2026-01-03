import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn(async () => ({ user: { role: "admin" } }));
const createWebhookTargetMock = vi.fn(async (input: any) => ({ id: 1, ...input }));

vi.mock("@/lib/auth", () => {
  return {
    getSession: getSessionMock,
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
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认：管理员可执行
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });
    createWebhookTargetMock.mockImplementation(async (input: any) => ({ id: 1, ...input }));
  });

  test("testWebhookAction 不阻止内网 URL（但会因 hostname 不支持而失败）", async () => {
    // 该用例验证：输入层允许内网 IP（不会被拦截），但 provider 检测会因 hostname 不受支持而失败
    const { testWebhookAction } = await import("@/actions/notifications");
    const result = await testWebhookAction("http://127.0.0.1:8080/webhook", "cost-alert");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported webhook hostname");
  });

  test("testWebhookAction 非管理员应被拒绝", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { role: "user" } });

    const { testWebhookAction } = await import("@/actions/notifications");
    const result = await testWebhookAction("http://127.0.0.1:8080/webhook", "cost-alert");

    expect(result.success).toBe(false);
    expect(result.error).toBe("无权限执行此操作");
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
