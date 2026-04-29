import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getNotificationSettingsActionMock = vi.hoisted(() => vi.fn());
const updateNotificationSettingsActionMock = vi.hoisted(() => vi.fn());
const testWebhookActionMock = vi.hoisted(() => vi.fn());
const getBindingsForTypeActionMock = vi.hoisted(() => vi.fn());
const updateBindingsActionMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/notifications", () => ({
  getNotificationSettingsAction: getNotificationSettingsActionMock,
  updateNotificationSettingsAction: updateNotificationSettingsActionMock,
  testWebhookAction: testWebhookActionMock,
}));

vi.mock("@/actions/notification-bindings", () => ({
  getBindingsForTypeAction: getBindingsForTypeActionMock,
  updateBindingsAction: updateBindingsActionMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const settings = {
  id: 1,
  enabled: true,
  useLegacyMode: false,
  circuitBreakerEnabled: true,
  circuitBreakerWebhook: "https://circuit-token:circuit-secret@example.com/circuit",
  dailyLeaderboardEnabled: true,
  dailyLeaderboardWebhook: "https://leaderboard.example.com/webhook?token=leaderboard-secret",
  dailyLeaderboardTime: "09:00",
  dailyLeaderboardTopN: 10,
  costAlertEnabled: false,
  costAlertWebhook: "https://cost.example.com/webhook?token=cost-secret",
  costAlertThreshold: null,
  costAlertCheckInterval: null,
  cacheHitRateAlertEnabled: false,
  cacheHitRateAlertWebhook: "https://cache.example.com/webhook?token=cache-secret",
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
  createdAt: new Date("2026-04-28T00:00:00.000Z"),
  updatedAt: new Date("2026-04-28T00:00:00.000Z"),
};

const binding = {
  id: 7,
  notificationType: "cost_alert",
  targetId: 10,
  isEnabled: true,
  scheduleCron: null,
  scheduleTimezone: null,
  templateOverride: null,
  createdAt: new Date("2026-04-28T00:00:00.000Z"),
  target: {
    id: 10,
    name: "Ops",
    providerType: "telegram",
    webhookUrl: "https://token:secret@example.com/webhook",
    telegramBotToken: "raw-token",
    telegramChatId: "chat",
    dingtalkSecret: "raw-secret",
    customTemplate: null,
    customHeaders: {
      Authorization: "Bearer webhook-secret",
      "X-Trace": "safe-trace",
    },
    proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
    proxyFallbackToDirect: false,
    isEnabled: true,
    lastTestAt: null,
    lastTestResult: null,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
  },
};

describe("v1 notification endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getNotificationSettingsActionMock.mockResolvedValue(settings);
    updateNotificationSettingsActionMock.mockResolvedValue({ ok: true, data: settings });
    testWebhookActionMock.mockResolvedValue({ success: true });
    getBindingsForTypeActionMock.mockResolvedValue({ ok: true, data: [binding] });
    updateBindingsActionMock.mockResolvedValue({ ok: true, data: undefined });
  });

  test("reads and updates notification settings", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/notifications/settings",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(got.response.status).toBe(200);
    expect(got.json).toMatchObject({
      enabled: true,
      circuitBreakerWebhook: "[REDACTED]",
      dailyLeaderboardWebhook: "[REDACTED]",
      costAlertWebhook: "[REDACTED]",
      cacheHitRateAlertWebhook: "[REDACTED]",
      updatedAt: "2026-04-28T00:00:00.000Z",
    });
    expect(JSON.stringify(got.json)).not.toContain("circuit-secret");
    expect(JSON.stringify(got.json)).not.toContain("leaderboard-secret");
    expect(JSON.stringify(got.json)).not.toContain("cost-secret");
    expect(JSON.stringify(got.json)).not.toContain("cache-secret");

    const updated = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/notifications/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: { enabled: false },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.json).toMatchObject({
      circuitBreakerWebhook: "[REDACTED]",
      dailyLeaderboardWebhook: "[REDACTED]",
      costAlertWebhook: "[REDACTED]",
      cacheHitRateAlertWebhook: "[REDACTED]",
    });
    expect(updateNotificationSettingsActionMock).toHaveBeenCalledWith({ enabled: false });
  });

  test("preserves legacy notification webhooks when redacted values are echoed", async () => {
    const updated = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/notifications/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        enabled: false,
        circuitBreakerWebhook: "[REDACTED]",
        dailyLeaderboardWebhook: "[REDACTED]",
        costAlertWebhook: "[REDACTED]",
        cacheHitRateAlertWebhook: "[REDACTED]",
      },
    });

    expect(updated.response.status).toBe(200);
    expect(updateNotificationSettingsActionMock).toHaveBeenCalledWith({ enabled: false });
  });

  test("tests webhook URLs and validates request body", async () => {
    const ok = await callV1Route({
      method: "POST",
      pathname: "/api/v1/notifications/test-webhook",
      headers: { Authorization: "Bearer admin-token" },
      body: { webhookUrl: "https://example.com/webhook", type: "cost_alert" },
    });
    expect(ok.response.status).toBe(200);
    expect(ok.json).toEqual({ success: true });
    expect(testWebhookActionMock).toHaveBeenCalledWith("https://example.com/webhook", "cost_alert");

    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/notifications/test-webhook",
      headers: { Authorization: "Bearer admin-token" },
      body: { webhookUrl: "not-a-url", type: "cost_alert" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("lists and replaces notification bindings with redacted target secrets", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/notifications/types/cost_alert/bindings",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [
        {
          id: 7,
          target: {
            webhookUrl: "[REDACTED]",
            customHeaders: {
              Authorization: "[REDACTED]",
              "X-Trace": "safe-trace",
            },
            proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
            telegramBotToken: null,
            dingtalkSecret: null,
          },
        },
      ],
    });
    expect(JSON.stringify(list.json)).not.toContain("token:secret");
    expect(JSON.stringify(list.json)).not.toContain("webhook-secret");
    expect(JSON.stringify(list.json)).not.toContain("proxy-pass");

    const replaced = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/notifications/types/cost_alert/bindings",
      headers: { Authorization: "Bearer admin-token" },
      body: { items: [{ targetId: 10, isEnabled: true }] },
    });
    expect(replaced.response.status).toBe(204);
    expect(updateBindingsActionMock).toHaveBeenCalledWith("cost_alert", [
      { targetId: 10, isEnabled: true },
    ]);
  });

  test("maps notification action failures to problem+json responses", async () => {
    getNotificationSettingsActionMock.mockResolvedValueOnce({
      ok: false,
      error: "权限不足",
      errorCode: "notification.forbidden",
    });
    const settingsFailed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/notifications/settings",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(settingsFailed.response.status).toBe(403);
    expect(settingsFailed.json).toMatchObject({ errorCode: "notification.forbidden" });

    updateNotificationSettingsActionMock.mockResolvedValueOnce({
      ok: false,
      error: "保存失败",
    });
    const updateFailed = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/notifications/settings",
      headers: { Authorization: "Bearer admin-token" },
      body: { enabled: false },
    });
    expect(updateFailed.response.status).toBe(400);
    expect(updateFailed.json).toMatchObject({ errorCode: "notification.action_failed" });

    testWebhookActionMock.mockResolvedValueOnce({
      ok: false,
      error: "",
    });
    const webhookFailed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/notifications/test-webhook",
      headers: { Authorization: "Bearer admin-token" },
      body: { webhookUrl: "https://example.com/webhook", type: "cost_alert" },
    });
    expect(webhookFailed.response.status).toBe(400);
    expect(webhookFailed.json).toMatchObject({ detail: "Bad request" });

    getBindingsForTypeActionMock.mockResolvedValueOnce({
      ok: false,
      error: "绑定读取失败",
      errorParams: { type: "cost_alert" },
    });
    const bindingsFailed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/notifications/types/cost_alert/bindings",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(bindingsFailed.response.status).toBe(400);
    expect(bindingsFailed.json).toMatchObject({
      errorCode: "notification.action_failed",
      errorParams: { type: "cost_alert" },
    });

    updateBindingsActionMock.mockResolvedValueOnce({
      ok: false,
      error: "无权限更新",
    });
    const replaceFailed = await callV1Route({
      method: "PUT",
      pathname: "/api/v1/notifications/types/cost_alert/bindings",
      headers: { Authorization: "Bearer admin-token" },
      body: { items: [] },
    });
    expect(replaceFailed.response.status).toBe(403);
    expect(replaceFailed.json).toMatchObject({ errorCode: "notification.action_failed" });
  });

  test("rejects malformed JSON bodies before notification actions run", async () => {
    const handlers = await import("@/app/api/v1/resources/notifications/handlers");
    const context = (pathname: string) =>
      ({
        req: {
          url: `http://localhost${pathname}`,
          raw: new Request(`http://localhost${pathname}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          }),
          header: () => undefined,
          json: async () => {
            throw new Error("malformed");
          },
          param: (name: string) => (name === "type" ? "cost_alert" : undefined),
        },
        get: () => ({ session: adminSession, allowReadOnlyAccess: false }),
      }) as never;

    const responses = await Promise.all([
      handlers.updateNotificationSettings(context("/api/v1/notifications/settings")),
      handlers.testNotificationWebhook(context("/api/v1/notifications/test-webhook")),
      handlers.updateNotificationBindings(
        context("/api/v1/notifications/types/cost_alert/bindings")
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    await expect(responses[0].json()).resolves.toMatchObject({
      errorCode: "request.malformed_json",
    });
    await expect(responses[1].json()).resolves.toMatchObject({
      errorCode: "request.malformed_json",
    });
    await expect(responses[2].json()).resolves.toMatchObject({
      errorCode: "request.malformed_json",
    });
  });

  test("rejects non-json notification write bodies with 415", async () => {
    const handlers = await import("@/app/api/v1/resources/notifications/handlers");
    const context = (pathname: string) =>
      ({
        req: {
          url: `http://localhost${pathname}`,
          raw: new Request(`http://localhost${pathname}`, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "not-json",
          }),
          header: () => undefined,
          param: (name: string) => (name === "type" ? "cost_alert" : undefined),
        },
        get: () => ({ session: adminSession, allowReadOnlyAccess: false }),
      }) as never;

    const response = await handlers.updateNotificationSettings(
      context("/api/v1/notifications/settings")
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      status: 415,
    });
  });

  test("rejects invalid notification JSON with validation errors", async () => {
    const got = await callV1Route({
      method: "POST",
      pathname: "/api/v1/notifications/test-webhook",
      headers: { Authorization: "Bearer admin-token" },
      body: { webhookUrl: "not-a-url", type: "cost_alert" },
    });
    expect(got.response.status).toBe(400);
    expect(got.json).toMatchObject({
      errorCode: "request.validation_failed",
    });
  });

  test("documents notification REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/notifications/settings");
    expect(doc.paths).toHaveProperty("/api/v1/notifications/test-webhook");
    expect(doc.paths).toHaveProperty("/api/v1/notifications/types/{type}/bindings");
  });
});
