/**
 * /api/v1/dashboard 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const dashboardKeys = {
  all: [...v1Keys.all, "dashboard"] as const,
  overview: () => [...dashboardKeys.all, "overview"] as const,
  realtime: () => [...dashboardKeys.all, "realtime"] as const,
  statistics: (timeRange?: string) =>
    [...dashboardKeys.all, "statistics", timeRange ?? ""] as const,
  concurrentSessions: () => [...dashboardKeys.all, "concurrent-sessions"] as const,
  providerSlots: () => [...dashboardKeys.all, "provider-slots"] as const,
  rateLimitStats: () => [...dashboardKeys.all, "rate-limit-stats"] as const,
  clientVersions: () => [...dashboardKeys.all, "client-versions"] as const,
  proxyStatus: () => [...dashboardKeys.all, "proxy-status"] as const,
};

export type DashboardQueryKey = ReturnType<
  (typeof dashboardKeys)[Exclude<keyof typeof dashboardKeys, "all">]
>;
