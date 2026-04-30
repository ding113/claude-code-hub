/**
 * /api/v1/admin/users/{id}/insights 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const adminUserInsightsKeys = {
  all: [...v1Keys.all, "admin-user-insights"] as const,
  overview: (userId: number, startDate?: string, endDate?: string) =>
    [...adminUserInsightsKeys.all, "overview", userId, startDate ?? "", endDate ?? ""] as const,
  keyTrend: (userId: number, timeRange: string) =>
    [...adminUserInsightsKeys.all, "key-trend", userId, timeRange] as const,
  modelBreakdown: (userId: number, params?: Record<string, unknown>) =>
    [...adminUserInsightsKeys.all, "model-breakdown", userId, params ?? {}] as const,
  providerBreakdown: (userId: number, params?: Record<string, unknown>) =>
    [...adminUserInsightsKeys.all, "provider-breakdown", userId, params ?? {}] as const,
};

export type AdminUserInsightsQueryKey = ReturnType<
  (typeof adminUserInsightsKeys)[Exclude<keyof typeof adminUserInsightsKeys, "all">]
>;
