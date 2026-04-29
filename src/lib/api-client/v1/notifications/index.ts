/**
 * /api/v1/notifications 类型化客户端方法
 */

import type {
  NotificationSettingsResponse,
  NotificationSettingsUpdateInput,
  TestWebhookRequest,
  TestWebhookResponse,
} from "@/lib/api/v1/schemas/notifications";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/notifications";

export interface NotificationsClient {
  getSettings(): Promise<NotificationSettingsResponse>;
  updateSettings(input: NotificationSettingsUpdateInput): Promise<NotificationSettingsResponse>;
  testWebhook(input: TestWebhookRequest): Promise<TestWebhookResponse>;
}

async function getSettings(): Promise<NotificationSettingsResponse> {
  const response = await fetchApi(`${BASE_PATH}/settings`, { method: "GET" });
  return (await response.json()) as NotificationSettingsResponse;
}

async function updateSettings(
  input: NotificationSettingsUpdateInput
): Promise<NotificationSettingsResponse> {
  const response = await fetchApi(`${BASE_PATH}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as NotificationSettingsResponse;
}

async function testWebhook(input: TestWebhookRequest): Promise<TestWebhookResponse> {
  const response = await fetchApi(`${BASE_PATH}/test-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as TestWebhookResponse;
}

export const notificationsClient: NotificationsClient = {
  getSettings,
  updateSettings,
  testWebhook,
};

Object.assign(apiClient, { notifications: notificationsClient });
