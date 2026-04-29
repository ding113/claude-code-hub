/**
 * /api/v1/webhook-targets 客户端查询键
 *
 * 与 v1Keys.all 派生，用于 TanStack Query 的缓存失效（前缀匹配）。
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const webhookTargetsKeys = {
  all: [...v1Keys.all, "webhook-targets"] as const,
  list: () => [...webhookTargetsKeys.all, "list"] as const,
  detail: (id: number) => [...webhookTargetsKeys.all, "detail", id] as const,
};

export type WebhookTargetsQueryKey = ReturnType<
  (typeof webhookTargetsKeys)[Exclude<keyof typeof webhookTargetsKeys, "all">]
>;
