import type { AuthSession } from "@/lib/auth";
import type { WebhookTarget } from "@/repository/webhook-targets";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getWebhookTargetsActionMock = vi.hoisted(() => vi.fn());
const createWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const updateWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const deleteWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const testWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/webhook-targets", () => ({
  getWebhookTargetsAction: getWebhookTargetsActionMock,
  createWebhookTargetAction: createWebhookTargetActionMock,
  updateWebhookTargetAction: updateWebhookTargetActionMock,
  deleteWebhookTargetAction: deleteWebhookTargetActionMock,
  testWebhookTargetAction: testWebhookTargetActionMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    validateAuthToken: validateAuthTokenMock,
  };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const target = {
  id: 10,
  name: "Ops",
  providerType: "dingtalk",
  webhookUrl: "https://token:secret@example.com/webhook",
  telegramBotToken: null,
  telegramChatId: null,
  dingtalkSecret: "raw-secret",
  customTemplate: null,
  customHeaders: {
    Authorization: "Bearer webhook-secret",
    "X-Trace": "safe-trace",
  },
  proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
  proxyFallbackToDirect: false,
  isEnabled: true,
  lastTestAt: new Date("2026-04-28T00:00:00.000Z"),
  lastTestResult: null,
  createdAt: new Date("2026-04-28T00:00:00.000Z"),
  updatedAt: new Date("2026-04-28T00:00:00.000Z"),
} satisfies WebhookTarget;

describe("v1 webhook targets CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getWebhookTargetsActionMock.mockResolvedValue({ ok: true, data: [target] });
    createWebhookTargetActionMock.mockResolvedValue({ ok: true, data: target });
    updateWebhookTargetActionMock.mockResolvedValue({
      ok: true,
      data: { ...target, name: "Ops 2" },
    });
    deleteWebhookTargetActionMock.mockResolvedValue({ ok: true });
    testWebhookTargetActionMock.mockResolvedValue({ ok: true, data: { latencyMs: 12 } });
  });

  test("lists targets and redacts write-only secrets", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/webhook-targets",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      items: [
        {
          id: 10,
          webhookUrl: "[REDACTED]",
          customHeaders: {
            Authorization: "[REDACTED]",
            "X-Trace": "safe-trace",
          },
          proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
          telegramBotToken: null,
          dingtalkSecret: null,
          createdAt: "2026-04-28T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("webhook-secret");
    expect(JSON.stringify(json)).not.toContain("token:secret");
    expect(JSON.stringify(json)).not.toContain("proxy-pass");
  });

  test("reads a single target and redacts write-only secrets", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      id: 10,
      webhookUrl: "[REDACTED]",
      telegramBotToken: null,
      dingtalkSecret: null,
      proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
    });
  });

  test("preserves stored webhook secrets when redacted read values are echoed in PATCH", async () => {
    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Ops 2",
        webhookUrl: "[REDACTED]",
        dingtalkSecret: null,
        customHeaders: {
          authorization: "[REDACTED]",
          "X-Trace": "changed-trace",
        },
        proxyUrl: "https://REDACTED:REDACTED@proxy.example.com/",
      },
    });

    expect(updated.response.status).toBe(200);
    expect(updateWebhookTargetActionMock).toHaveBeenCalledWith(10, {
      name: "Ops 2",
      customHeaders: {
        authorization: "Bearer webhook-secret",
        "X-Trace": "changed-trace",
      },
    });
  });

  test("preserves stored Telegram bot tokens when an edit echoes empty redacted fields", async () => {
    const telegramTarget = {
      ...target,
      providerType: "telegram",
      webhookUrl: null,
      telegramBotToken: "telegram-secret",
      telegramChatId: "chat-id",
      dingtalkSecret: null,
      customHeaders: null,
    } satisfies WebhookTarget;
    getWebhookTargetsActionMock.mockResolvedValueOnce({ ok: true, data: [telegramTarget] });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Telegram Ops",
        providerType: "telegram",
        telegramBotToken: null,
        telegramChatId: "chat-id",
      },
    });

    expect(updated.response.status).toBe(200);
    expect(updateWebhookTargetActionMock).toHaveBeenCalledWith(10, {
      name: "Telegram Ops",
      providerType: "telegram",
      telegramChatId: "chat-id",
    });
  });

  test("creates, updates, deletes, and tests targets with REST semantics", async () => {
    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/webhook-targets",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Ops",
        providerType: "dingtalk",
        webhookUrl: "https://example.com/webhook",
        dingtalkSecret: "raw-secret",
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/webhook-targets/10");
    expect(JSON.stringify(created.json)).not.toContain("raw-secret");
    expect(JSON.stringify(created.json)).not.toContain("webhook-secret");
    expect(JSON.stringify(created.json)).not.toContain("proxy-pass");

    const redactedCreate = await callV1Route({
      method: "POST",
      pathname: "/api/v1/webhook-targets",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Copied Ops",
        providerType: "dingtalk",
        webhookUrl: "https://example.com/webhook",
        customHeaders: { Authorization: "[REDACTED]" },
      },
    });
    expect(redactedCreate.response.status).toBe(422);
    expect(redactedCreate.json).toMatchObject({
      errorCode: "webhook_target.redacted_placeholder_rejected",
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "Ops 2" },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.json).toMatchObject({ name: "Ops 2" });

    const testResult = await callV1Route({
      method: "POST",
      pathname: "/api/v1/webhook-targets/10:test",
      headers: { Authorization: "Bearer admin-token" },
      body: { notificationType: "cost_alert" },
    });
    expect(testResult.response.status).toBe(200);
    expect(testResult.json).toEqual({ latencyMs: 12 });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
  });

  test("returns problem+json for validation and not-found failures", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/webhook-targets",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "", providerType: "dingtalk" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    getWebhookTargetsActionMock.mockResolvedValueOnce({ ok: true, data: [] });
    const missing = await callV1Route({
      method: "GET",
      pathname: "/api/v1/webhook-targets/404",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "webhook_target.not_found" });
  });

  test("maps webhook target action failures to problem+json responses", async () => {
    getWebhookTargetsActionMock.mockResolvedValueOnce({
      ok: false,
      error: "权限不足",
      errorCode: "webhook_target.forbidden",
    });
    const listFailed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/webhook-targets",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(listFailed.response.status).toBe(403);
    expect(listFailed.json).toMatchObject({ errorCode: "webhook_target.forbidden" });

    getWebhookTargetsActionMock.mockResolvedValueOnce({
      ok: false,
      error: "查询失败",
    });
    const detailFailed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(detailFailed.response.status).toBe(400);
    expect(detailFailed.json).toMatchObject({ errorCode: "webhook_target.action_failed" });

    createWebhookTargetActionMock.mockResolvedValueOnce({
      ok: false,
      error: "创建失败",
      errorParams: { name: "Ops" },
    });
    const createFailed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/webhook-targets",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Ops",
        providerType: "dingtalk",
        webhookUrl: "https://example.com/webhook",
      },
    });
    expect(createFailed.response.status).toBe(400);
    expect(createFailed.json).toMatchObject({
      errorCode: "webhook_target.action_failed",
      errorParams: { name: "Ops" },
    });

    updateWebhookTargetActionMock.mockResolvedValueOnce({
      ok: false,
      error: "目标不存在",
    });
    const updateFailed = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "Ops 2" },
    });
    expect(updateFailed.response.status).toBe(404);

    deleteWebhookTargetActionMock.mockResolvedValueOnce({
      ok: false,
      error: "",
    });
    const deleteFailed = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/webhook-targets/10",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleteFailed.response.status).toBe(400);
    expect(deleteFailed.json).toMatchObject({ detail: "Bad request" });

    testWebhookTargetActionMock.mockResolvedValueOnce({
      ok: false,
      error: "测试失败",
    });
    const testFailed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/webhook-targets/10:test",
      headers: { Authorization: "Bearer admin-token" },
      body: { notificationType: "cost_alert" },
    });
    expect(testFailed.response.status).toBe(400);
    expect(testFailed.json).toMatchObject({ errorCode: "webhook_target.action_failed" });
  });

  test("rejects malformed JSON bodies before webhook target actions run", async () => {
    const handlers = await import("@/app/api/v1/resources/webhook-targets/handlers");
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
          param: (name: string) => (name === "id" ? "10" : undefined),
        },
        get: () => ({ session: adminSession, allowReadOnlyAccess: false }),
      }) as never;

    const responses = await Promise.all([
      handlers.createWebhookTarget(context("/api/v1/webhook-targets")),
      handlers.updateWebhookTarget(context("/api/v1/webhook-targets/10")),
      handlers.testWebhookTarget(context("/api/v1/webhook-targets/10:test")),
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

  test("rejects non-json webhook target write bodies with 415", async () => {
    const handlers = await import("@/app/api/v1/resources/webhook-targets/handlers");
    const response = await handlers.updateWebhookTarget({
      req: {
        url: "http://localhost/api/v1/webhook-targets/10",
        raw: new Request("http://localhost/api/v1/webhook-targets/10", {
          method: "PATCH",
          headers: { "Content-Type": "text/plain" },
          body: "not-json",
        }),
        header: () => undefined,
        param: (name: string) => (name === "id" ? "10" : undefined),
      },
      get: () => ({ session: adminSession, allowReadOnlyAccess: false }),
    } as never);

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      status: 415,
    });
  });
});
