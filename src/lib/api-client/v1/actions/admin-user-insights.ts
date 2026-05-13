import { apiGet, searchParams, toActionResult, unwrapItems } from "./_compat";

type InsightBreakdownItem = {
  model: string;
  providerName: string;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

type InsightBreakdownResponse = {
  breakdown: InsightBreakdownItem[];
  currencyCode: string;
};

export function getUserInsightsOverview(userId: number, startDate?: string, endDate?: string) {
  return toActionResult(
    apiGet(`/api/v1/admin/users/${userId}/insights/overview${searchParams({ startDate, endDate })}`)
  );
}

export function getUserInsightsKeyTrend(userId: number, timeRange?: string) {
  return toActionResult(
    apiGet<{ items?: unknown[] }>(
      `/api/v1/admin/users/${userId}/insights/key-trend${searchParams({ timeRange })}`
    ).then(unwrapItems)
  );
}

export function getUserInsightsModelBreakdown(
  userId: number,
  startDate?: string,
  endDate?: string,
  filters?: Record<string, unknown>
) {
  return toActionResult(
    apiGet<InsightBreakdownResponse>(
      `/api/v1/admin/users/${userId}/insights/model-breakdown${searchParams({
        startDate,
        endDate,
        keyId: asQuery(filters?.keyId),
        providerId: asQuery(filters?.providerId),
      })}`
    )
  );
}

export function getUserInsightsProviderBreakdown(
  userId: number,
  startDate?: string,
  endDate?: string,
  filters?: Record<string, unknown>
) {
  return toActionResult(
    apiGet<InsightBreakdownResponse>(
      `/api/v1/admin/users/${userId}/insights/provider-breakdown${searchParams({
        startDate,
        endDate,
        keyId: asQuery(filters?.keyId),
        model: asQuery(filters?.model),
      })}`
    )
  );
}

function asQuery(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
