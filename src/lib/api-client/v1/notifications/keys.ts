/**
 * /api/v1/notifications 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const notificationsKeys = {
  all: [...v1Keys.all, "notifications"] as const,
  settings: () => [...notificationsKeys.all, "settings"] as const,
};

export type NotificationsQueryKey = ReturnType<
  (typeof notificationsKeys)[Exclude<keyof typeof notificationsKeys, "all">]
>;
