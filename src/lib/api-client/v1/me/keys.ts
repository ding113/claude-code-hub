/**
 * /api/v1/me 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const meKeys = {
  all: [...v1Keys.all, "me"] as const,
  metadata: () => [...meKeys.all, "metadata"] as const,
  quota: () => [...meKeys.all, "quota"] as const,
  today: () => [...meKeys.all, "today"] as const,
  usageLogs: (params?: Record<string, unknown>) =>
    [...meKeys.all, "usage-logs", params ?? {}] as const,
  usageLogsFull: (params?: Record<string, unknown>) =>
    [...meKeys.all, "usage-logs", "full", params ?? {}] as const,
  models: () => [...meKeys.all, "usage-logs", "models"] as const,
  endpoints: () => [...meKeys.all, "usage-logs", "endpoints"] as const,
  statsSummary: (params?: Record<string, unknown>) =>
    [...meKeys.all, "usage-logs", "stats-summary", params ?? {}] as const,
  ipGeo: (ip: string, lang?: string) => [...meKeys.all, "ip-geo", ip, lang ?? ""] as const,
};

export type MeQueryKey = ReturnType<(typeof meKeys)[Exclude<keyof typeof meKeys, "all">]>;
