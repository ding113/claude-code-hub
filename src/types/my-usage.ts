/**
 * Browser-safe type definitions for the My Usage UI.
 *
 * Mirrors the shapes returned by `src/actions/my-usage.ts` and the
 * equivalent `/api/v1/me/*` endpoints (which use passthrough schemas).
 * Centralised here so client components do not need to import from
 * `@/actions/my-usage` (a "use server" module).
 */

import type { CurrencyCode } from "@/lib/utils";
import type { BillingModelSource } from "@/types/system-config";

export interface MyUsageMetadata {
  keyName: string;
  keyProviderGroup: string | null;
  keyExpiresAt: Date | string | null;
  keyIsEnabled: boolean;
  userName: string;
  userProviderGroup: string | null;
  userExpiresAt: Date | string | null;
  userIsEnabled: boolean;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

export interface MyUsageQuota {
  keyLimit5hUsd: number | null;
  keyLimitDailyUsd: number | null;
  keyLimitWeeklyUsd: number | null;
  keyLimitMonthlyUsd: number | null;
  keyLimitTotalUsd: number | null;
  keyLimitConcurrentSessions: number;
  keyCurrent5hUsd: number;
  keyCurrentDailyUsd: number;
  keyCurrentWeeklyUsd: number;
  keyCurrentMonthlyUsd: number;
  keyCurrentTotalUsd: number;
  keyCurrentConcurrentSessions: number;

  userLimit5hUsd: number | null;
  userLimitWeeklyUsd: number | null;
  userLimitMonthlyUsd: number | null;
  userLimitTotalUsd: number | null;
  userLimitConcurrentSessions: number | null;
  userRpmLimit: number | null;
  userCurrent5hUsd: number;
  userCurrentDailyUsd: number;
  userCurrentWeeklyUsd: number;
  userCurrentMonthlyUsd: number;
  userCurrentTotalUsd: number;
  userCurrentConcurrentSessions: number;

  userLimitDailyUsd: number | null;
  userExpiresAt: Date | string | null;
  userProviderGroup: string | null;
  userName: string;
  userIsEnabled: boolean;

  keyProviderGroup: string | null;
  keyName: string;
  keyIsEnabled: boolean;

  userAllowedModels: string[];
  userAllowedClients: string[];

  expiresAt: Date | string | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
}

export interface MyTodayStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  modelBreakdown: Array<{
    model: string | null;
    billingModel: string | null;
    calls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

export interface MyUsageLogEntry {
  id: number;
  createdAt: Date | string | null;
  model: string | null;
  billingModel: string | null;
  anthropicEffort?: string | null;
  modelRedirect: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  statusCode: number | null;
  duration: number | null;
  endpoint: string | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
}

export interface MyUsageLogsBatchResult {
  logs: MyUsageLogEntry[];
  nextCursor: { createdAt: string; id: number } | null;
  hasMore: boolean;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

export interface MyUsageLogsFilters {
  startDate?: string;
  endDate?: string;
  startTime?: number;
  endTime?: number;
  sessionId?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
  page?: number;
  pageSize?: number;
}

export interface MyUsageLogsResult {
  logs: MyUsageLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

export interface MyUsageLogsBatchFilters {
  startDate?: string;
  endDate?: string;
  startTime?: number;
  endTime?: number;
  sessionId?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
  cursor?: { createdAt: string; id: number };
  limit?: number;
}

export interface ModelBreakdownItem {
  model: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
}

export interface MyStatsSummaryFilters {
  startDate?: string;
  endDate?: string;
}

export interface MyStatsSummary {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreation5mTokens: number;
  totalCacheCreation1hTokens: number;
  keyModelBreakdown: ModelBreakdownItem[];
  userModelBreakdown: ModelBreakdownItem[];
  currencyCode: CurrencyCode;
}
