/**
 * /api/v1/usage-logs 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const usageLogsKeys = {
  all: [...v1Keys.all, "usage-logs"] as const,
  list: (params?: Record<string, unknown>) => [...usageLogsKeys.all, "list", params ?? {}] as const,
  stats: (params?: Record<string, unknown>) =>
    [...usageLogsKeys.all, "stats", params ?? {}] as const,
  filterOptions: () => [...usageLogsKeys.all, "filter-options"] as const,
  sessionIdSuggestions: (params?: Record<string, unknown>) =>
    [...usageLogsKeys.all, "session-id-suggestions", params ?? {}] as const,
  exportStatus: (jobId: string) => [...usageLogsKeys.all, "exports", jobId] as const,
};

export type UsageLogsQueryKey = ReturnType<
  (typeof usageLogsKeys)[Exclude<keyof typeof usageLogsKeys, "all">]
>;
