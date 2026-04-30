/**
 * /api/v1/notifications/types/{type}/bindings 类型化客户端方法
 */

import type {
  NotificationBindingListResponse,
  NotificationBindingsUpdateInput,
} from "@/lib/api/v1/schemas/notification-bindings";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";
import type { NotificationType } from "@/repository/notification-bindings";

const BASE_PATH = "/api/v1/notifications/types";

export interface NotificationBindingsClient {
  list(type: NotificationType): Promise<NotificationBindingListResponse>;
  update(
    type: NotificationType,
    input: NotificationBindingsUpdateInput
  ): Promise<NotificationBindingListResponse>;
}

async function list(type: NotificationType): Promise<NotificationBindingListResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(type)}/bindings`, {
    method: "GET",
  });
  return (await response.json()) as NotificationBindingListResponse;
}

async function update(
  type: NotificationType,
  input: NotificationBindingsUpdateInput
): Promise<NotificationBindingListResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(type)}/bindings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as NotificationBindingListResponse;
}

export const notificationBindingsClient: NotificationBindingsClient = {
  list,
  update,
};

Object.assign(apiClient, { notificationBindings: notificationBindingsClient });
