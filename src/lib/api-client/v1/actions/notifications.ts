import { apiGet, apiPost, apiPut, toActionResult } from "./_compat";

export function getNotificationSettingsAction() {
  return apiGet("/api/v1/notifications/settings");
}

export function updateNotificationSettingsAction(data: Record<string, any>) {
  return toActionResult(apiPut("/api/v1/notifications/settings", data));
}

export function testWebhookAction(webhookUrl: string, type: string) {
  return toActionResult(apiPost("/api/v1/notifications/test-webhook", { webhookUrl, type }));
}
