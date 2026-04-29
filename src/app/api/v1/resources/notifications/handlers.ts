import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { sanitizeLegacyNotificationSettingsResponse } from "@/lib/api/legacy-action-sanitizers";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { redactHeaderRecord, redactUrlCredentials } from "@/lib/api/v1/_shared/redaction";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse, noContentResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  NotificationBindingUpdateSchema,
  NotificationSettingsUpdateSchema,
  NotificationTestWebhookRequestSchema,
} from "@/lib/api/v1/schemas/notifications";
import type { WebhookTarget } from "@/repository/webhook-targets";

export async function getNotificationSettings(c: Context): Promise<Response> {
  const actions = await import("@/actions/notifications");
  const result = await callAction(c, actions.getNotificationSettingsAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeLegacyNotificationSettingsResponse(result.data));
}

export async function updateNotificationSettings(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, NotificationSettingsUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/notifications");
  const result = await callAction(
    c,
    actions.updateNotificationSettingsAction,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeLegacyNotificationSettingsResponse(result.data));
}

export async function testNotificationWebhook(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, NotificationTestWebhookRequestSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/notifications");
  const result = await callAction(
    c,
    actions.testWebhookAction,
    [body.data.webhookUrl, body.data.type] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getNotificationBindings(c: Context): Promise<Response> {
  const type = c.req.param("type");
  const actions = await import("@/actions/notification-bindings");
  const result = await callAction(
    c,
    actions.getBindingsForTypeAction,
    [type] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data.map(sanitizeBinding) });
}

export async function updateNotificationBindings(c: Context): Promise<Response> {
  const type = c.req.param("type");
  const body = await parseHonoJsonBody(c, NotificationBindingUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/notification-bindings");
  const result = await callAction(
    c,
    actions.updateBindingsAction,
    [type, body.data.items] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

function sanitizeBinding<T extends { target: WebhookTarget }>(binding: T) {
  return {
    ...binding,
    target: {
      ...binding.target,
      webhookUrl: binding.target.webhookUrl ? "[REDACTED]" : null,
      customHeaders: redactHeaderRecord(binding.target.customHeaders),
      proxyUrl: redactUrlCredentials(binding.target.proxyUrl),
      telegramBotToken: null,
      dingtalkSecret: null,
    },
  };
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("权限") || detail.includes("无权限") ? 403 : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "notification.action_failed",
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
