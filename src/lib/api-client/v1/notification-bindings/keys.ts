/**
 * /api/v1/notifications/types/{type}/bindings 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";
import type { NotificationType } from "@/repository/notification-bindings";

export const notificationBindingsKeys = {
  all: [...v1Keys.all, "notification-bindings"] as const,
  list: (type: NotificationType) => [...notificationBindingsKeys.all, "list", type] as const,
};

export type NotificationBindingsQueryKey = ReturnType<
  (typeof notificationBindingsKeys)[Exclude<keyof typeof notificationBindingsKeys, "all">]
>;
