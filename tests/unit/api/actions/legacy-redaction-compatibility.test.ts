import type { AuthSession } from "@/lib/auth";
import type { WebhookTarget } from "@/repository/webhook-targets";
import type { ProviderDisplay } from "@/types/provider";
import { afterEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getProvidersMock = vi.hoisted(() => vi.fn());
const addProviderMock = vi.hoisted(() => vi.fn());
const editProviderMock = vi.hoisted(() => vi.fn());
const getWebhookTargetsActionMock = vi.hoisted(() => vi.fn());
const updateWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const getBindingsForTypeActionMock = vi.hoisted(() => vi.fn());
const getNotificationSettingsActionMock = vi.hoisted(() => vi.fn());
const updateNotificationSettingsActionMock = vi.hoisted(() => vi.fn());

const legacyAdminToken = process.env.TEST_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? "admin-token";

const adminSession = {
  user: { id: -1, role: "admin", isEnabled: true },
  key: { id: -1, userId: -1, key: legacyAdminToken, canLoginWebUi: true },
  credentialType: "admin-token",
} as AuthSession;

const provider = {
  id: 1,
  name: "Primary",
  url: "https://main-user:main-pass@api.example.com/v1",
  maskedKey: "sk-...1234",
  proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
  websiteUrl: "https://web-user:web-pass@example.com",
  mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
  customHeaders: {
    "Cf-Aig-Authorization": "Bearer upstream-secret",
    "X-Trace": "trace-id",
  },
} as ProviderDisplay;

const webhookTarget = {
  id: 10,
  name: "Ops",
  providerType: "telegram",
  webhookUrl: "https://token:secret@example.com/webhook",
  telegramBotToken: "telegram-secret-token",
  telegramChatId: "chat-id",
  dingtalkSecret: null,
  customTemplate: null,
  customHeaders: {
    "Cf-Aig-Authorization": "Bearer webhook-secret",
    "X-Trace": "trace-id",
  },
  proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
  proxyFallbackToDirect: false,
  isEnabled: true,
  lastTestAt: null,
  lastTestResult: null,
  createdAt: new Date("2026-04-29T00:00:00.000Z"),
  updatedAt: new Date("2026-04-29T00:00:00.000Z"),
} satisfies WebhookTarget;

async function postLegacyAction(moduleName: string, actionName: string, body: unknown) {
  const route = await import("@/app/api/actions/[...route]/route");
  const response = await route.POST(
    new Request(`http://localhost/api/actions/${moduleName}/${actionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${legacyAdminToken}`,
      },
      body: JSON.stringify(body),
    })
  );
  return { response, body: await response.json() };
}

describe("legacy actions API redaction compatibility", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/actions/providers");
    vi.doUnmock("@/actions/webhook-targets");
    vi.doUnmock("@/actions/notification-bindings");
    vi.doUnmock("@/actions/notifications");
    vi.resetModules();
  });

  test("redacts legacy notification settings webhook URLs on the legacy API", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getNotificationSettingsActionMock.mockResolvedValue({
      id: 1,
      enabled: true,
      useLegacyMode: true,
      circuitBreakerEnabled: true,
      circuitBreakerWebhook: "https://circuit-token:circuit-secret@example.com/circuit",
      dailyLeaderboardEnabled: true,
      dailyLeaderboardWebhook: "https://leaderboard.example.com/hook?token=leaderboard-secret",
      dailyLeaderboardTime: "09:00",
      dailyLeaderboardTopN: 10,
      costAlertEnabled: true,
      costAlertWebhook: "https://cost.example.com/hook?token=cost-secret",
      costAlertThreshold: "10",
      costAlertCheckInterval: 30,
      cacheHitRateAlertEnabled: true,
      cacheHitRateAlertWebhook: "https://cache.example.com/hook?token=cache-secret",
      cacheHitRateAlertWindowMode: null,
      cacheHitRateAlertCheckInterval: null,
      cacheHitRateAlertHistoricalLookbackDays: null,
      cacheHitRateAlertMinEligibleRequests: null,
      cacheHitRateAlertMinEligibleTokens: null,
      cacheHitRateAlertAbsMin: null,
      cacheHitRateAlertDropRel: null,
      cacheHitRateAlertDropAbs: null,
      cacheHitRateAlertCooldownMinutes: null,
      cacheHitRateAlertTopN: null,
      createdAt: new Date("2026-04-29T00:00:00.000Z"),
      updatedAt: new Date("2026-04-29T00:00:00.000Z"),
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/notifications", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/notifications")>();
      return {
        ...actual,
        getNotificationSettingsAction: getNotificationSettingsActionMock,
      };
    });

    const { response, body } = await postLegacyAction(
      "notifications",
      "getNotificationSettingsAction",
      {}
    );

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      circuitBreakerWebhook: "[REDACTED]",
      dailyLeaderboardWebhook: "[REDACTED]",
      costAlertWebhook: "[REDACTED]",
      cacheHitRateAlertWebhook: "[REDACTED]",
    });
    expect(JSON.stringify(body)).not.toContain("circuit-secret");
    expect(JSON.stringify(body)).not.toContain("leaderboard-secret");
    expect(JSON.stringify(body)).not.toContain("cost-secret");
    expect(JSON.stringify(body)).not.toContain("cache-secret");
  }, 20_000);

  test("redacts legacy notification settings webhook URLs after updates", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    updateNotificationSettingsActionMock.mockResolvedValue({
      ok: true,
      data: {
        id: 1,
        enabled: true,
        useLegacyMode: true,
        circuitBreakerEnabled: true,
        circuitBreakerWebhook: "https://circuit.example.com/hook?token=circuit-secret",
        dailyLeaderboardEnabled: false,
        dailyLeaderboardWebhook: null,
        dailyLeaderboardTime: null,
        dailyLeaderboardTopN: null,
        costAlertEnabled: false,
        costAlertWebhook: null,
        costAlertThreshold: null,
        costAlertCheckInterval: null,
        cacheHitRateAlertEnabled: false,
        cacheHitRateAlertWebhook: null,
        cacheHitRateAlertWindowMode: null,
        cacheHitRateAlertCheckInterval: null,
        cacheHitRateAlertHistoricalLookbackDays: null,
        cacheHitRateAlertMinEligibleRequests: null,
        cacheHitRateAlertMinEligibleTokens: null,
        cacheHitRateAlertAbsMin: null,
        cacheHitRateAlertDropRel: null,
        cacheHitRateAlertDropAbs: null,
        cacheHitRateAlertCooldownMinutes: null,
        cacheHitRateAlertTopN: null,
        createdAt: new Date("2026-04-29T00:00:00.000Z"),
        updatedAt: new Date("2026-04-29T00:00:00.000Z"),
      },
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/notifications", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/notifications")>();
      return {
        ...actual,
        updateNotificationSettingsAction: updateNotificationSettingsActionMock,
      };
    });

    const { response, body } = await postLegacyAction(
      "notifications",
      "updateNotificationSettingsAction",
      { circuitBreakerWebhook: "https://circuit.example.com/hook?token=circuit-secret" }
    );

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ circuitBreakerWebhook: "[REDACTED]" });
    expect(JSON.stringify(body)).not.toContain("circuit-secret");
  }, 20_000);

  test("redacts nested notification binding targets on the legacy API", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getBindingsForTypeActionMock.mockResolvedValue({
      ok: true,
      data: [{ id: 1, target: webhookTarget }],
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/notification-bindings", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/notification-bindings")>();
      return { ...actual, getBindingsForTypeAction: getBindingsForTypeActionMock };
    });

    const { response, body } = await postLegacyAction(
      "notification-bindings",
      "getBindingsForTypeAction",
      { type: "cost_alert" }
    );

    expect(response.status).toBe(200);
    expect(body.data[0].target).toMatchObject({
      webhookUrl: "[REDACTED]",
      telegramBotToken: "tele...[REDACTED]...oken",
      customHeaders: {
        "Cf-Aig-Authorization": "[REDACTED]",
        "X-Trace": "trace-id",
      },
      proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
    });
    expect(JSON.stringify(body)).not.toContain("webhook-secret");
    expect(JSON.stringify(body)).not.toContain("proxy-pass");
  }, 20_000);

  test("preserves legacy provider secrets when redacted values are echoed into editProvider", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getProvidersMock.mockResolvedValue([provider]);
    editProviderMock.mockResolvedValue({
      ok: true,
      data: { operationId: "op", undoToken: "undo" },
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/providers", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/providers")>();
      return {
        ...actual,
        getProviders: getProvidersMock,
        editProvider: editProviderMock,
      };
    });

    const { response } = await postLegacyAction("providers", "editProvider", {
      providerId: 1,
      name: "Renamed",
      url: "https://REDACTED:REDACTED@api.example.com/v1",
      proxy_url: "https://REDACTED:REDACTED@proxy.example.com/",
      website_url: "https://REDACTED:REDACTED@example.com/",
      mcp_passthrough_url: "https://REDACTED:REDACTED@mcp.example.com/bridge",
      custom_headers: {
        "cf-aig-authorization": "[REDACTED]",
        "X-Trace": "changed",
      },
    });

    expect(response.status).toBe(200);
    expect(editProviderMock).toHaveBeenCalledWith(1, {
      name: "Renamed",
      custom_headers: {
        "cf-aig-authorization": "Bearer upstream-secret",
        "X-Trace": "changed",
      },
    });
  }, 20_000);

  test("rejects legacy provider creates that contain redacted placeholders", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    addProviderMock.mockResolvedValue({ ok: true, data: { id: 2 } });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/providers", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/providers")>();
      return { ...actual, addProvider: addProviderMock };
    });

    const { response, body } = await postLegacyAction("providers", "addProvider", {
      name: "Clone",
      url: "https://REDACTED:REDACTED@api.example.com/v1",
      key: "sk-new",
      provider_type: "claude",
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false });
    expect(addProviderMock).not.toHaveBeenCalled();
  }, 20_000);

  test("preserves legacy webhook target secrets when redacted values are echoed into update", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getWebhookTargetsActionMock.mockResolvedValue({ ok: true, data: [webhookTarget] });
    updateWebhookTargetActionMock.mockResolvedValue({
      ok: true,
      data: { ...webhookTarget, name: "Ops 2" },
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/webhook-targets", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/webhook-targets")>();
      return {
        ...actual,
        getWebhookTargetsAction: getWebhookTargetsActionMock,
        updateWebhookTargetAction: updateWebhookTargetActionMock,
      };
    });

    const { response } = await postLegacyAction("webhook-targets", "updateWebhookTargetAction", {
      id: 10,
      input: {
        name: "Ops 2",
        providerType: "telegram",
        webhookUrl: "[REDACTED]",
        telegramBotToken: "tele...[REDACTED]...oken",
        customHeaders: {
          "cf-aig-authorization": "[REDACTED]",
          "X-Trace": "changed",
        },
        proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
      },
    });

    expect(response.status).toBe(200);
    expect(updateWebhookTargetActionMock).toHaveBeenCalledWith(10, {
      name: "Ops 2",
      providerType: "telegram",
      customHeaders: {
        "cf-aig-authorization": "Bearer webhook-secret",
        "X-Trace": "changed",
      },
    });
  }, 20_000);
});
