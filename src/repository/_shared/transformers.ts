import { formatCostForStorage } from "@/lib/utils/currency";
import type { Key } from "@/types/key";
import type { MessageRequest } from "@/types/message";
import type { ModelPrice } from "@/types/model-price";
import type { Provider } from "@/types/provider";
import type { ResponseFixerConfig, SystemSettings } from "@/types/system-config";
import type { User } from "@/types/user";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toUser(dbUser: any): User {
  const parseOptionalNumber = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = Number.parseFloat(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const parseOptionalInteger = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return {
    ...dbUser,
    description: dbUser?.description || "",
    role: (dbUser?.role as User["role"]) || "user",
    rpm: (() => {
      if (dbUser?.rpm === null || dbUser?.rpm === undefined) return null;
      const parsed = Number(dbUser.rpm);
      return parsed > 0 ? parsed : null;
    })(),
    dailyQuota: (() => {
      if (dbUser?.dailyQuota === null || dbUser?.dailyQuota === undefined) return null;
      const parsed = Number.parseFloat(dbUser.dailyQuota);
      return parsed > 0 ? parsed : null;
    })(),
    providerGroup: dbUser?.providerGroup ?? null,
    tags: dbUser?.tags ?? [],
    limit5hUsd: parseOptionalNumber(dbUser?.limit5hUsd),
    limitWeeklyUsd: parseOptionalNumber(dbUser?.limitWeeklyUsd),
    limitMonthlyUsd: parseOptionalNumber(dbUser?.limitMonthlyUsd),
    limitTotalUsd: parseOptionalNumber(dbUser?.limitTotalUsd),
    limitConcurrentSessions: parseOptionalInteger(dbUser?.limitConcurrentSessions),
    dailyResetMode: dbUser?.dailyResetMode ?? "fixed",
    dailyResetTime: dbUser?.dailyResetTime ?? "00:00",
    isEnabled: dbUser?.isEnabled ?? true,
    expiresAt: dbUser?.expiresAt ? new Date(dbUser.expiresAt) : null,
    allowedClients: dbUser?.allowedClients ?? [],
    allowedModels: dbUser?.allowedModels ?? [],
    createdAt: dbUser?.createdAt ? new Date(dbUser.createdAt) : new Date(),
    updatedAt: dbUser?.updatedAt ? new Date(dbUser.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toKey(dbKey: any): Key {
  return {
    ...dbKey,
    isEnabled: dbKey?.isEnabled ?? true,
    canLoginWebUi: dbKey?.canLoginWebUi ?? true,
    limit5hUsd: dbKey?.limit5hUsd ? parseFloat(dbKey.limit5hUsd) : null,
    limitDailyUsd: dbKey?.limitDailyUsd ? parseFloat(dbKey.limitDailyUsd) : null,
    dailyResetTime: dbKey?.dailyResetTime ?? "00:00",
    limitWeeklyUsd: dbKey?.limitWeeklyUsd ? parseFloat(dbKey.limitWeeklyUsd) : null,
    limitMonthlyUsd: dbKey?.limitMonthlyUsd ? parseFloat(dbKey.limitMonthlyUsd) : null,
    limitTotalUsd:
      dbKey?.limitTotalUsd !== null && dbKey?.limitTotalUsd !== undefined
        ? parseFloat(dbKey.limitTotalUsd)
        : null,
    limitConcurrentSessions: dbKey?.limitConcurrentSessions ?? 0,
    providerGroup: dbKey?.providerGroup ?? null,
    cacheTtlPreference: dbKey?.cacheTtlPreference ?? null,
    createdAt: dbKey?.createdAt ? new Date(dbKey.createdAt) : new Date(),
    updatedAt: dbKey?.updatedAt ? new Date(dbKey.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toProvider(dbProvider: any): Provider {
  return {
    ...dbProvider,
    providerVendorId: dbProvider?.providerVendorId ?? null,
    isEnabled: dbProvider?.isEnabled ?? true,
    weight: dbProvider?.weight ?? 1,
    priority: dbProvider?.priority ?? 0,
    costMultiplier: dbProvider?.costMultiplier ? parseFloat(dbProvider.costMultiplier) : 1.0,
    groupTag: dbProvider?.groupTag ?? null,
    providerType: dbProvider?.providerType ?? "claude",
    preserveClientIp: dbProvider?.preserveClientIp ?? false,
    modelRedirects: dbProvider?.modelRedirects ?? null,
    mcpPassthroughType: dbProvider?.mcpPassthroughType ?? "none",
    mcpPassthroughUrl: dbProvider?.mcpPassthroughUrl ?? null,
    limit5hUsd: dbProvider?.limit5hUsd ? parseFloat(dbProvider.limit5hUsd) : null,
    limitDailyUsd: dbProvider?.limitDailyUsd ? parseFloat(dbProvider.limitDailyUsd) : null,
    dailyResetTime: dbProvider?.dailyResetTime ?? "00:00",
    limitWeeklyUsd: dbProvider?.limitWeeklyUsd ? parseFloat(dbProvider.limitWeeklyUsd) : null,
    limitMonthlyUsd: dbProvider?.limitMonthlyUsd ? parseFloat(dbProvider.limitMonthlyUsd) : null,
    limitTotalUsd:
      dbProvider?.limitTotalUsd !== null && dbProvider?.limitTotalUsd !== undefined
        ? parseFloat(dbProvider.limitTotalUsd)
        : null,
    totalCostResetAt: dbProvider?.totalCostResetAt ? new Date(dbProvider.totalCostResetAt) : null,
    limitConcurrentSessions: dbProvider?.limitConcurrentSessions ?? 0,
    maxRetryAttempts:
      dbProvider?.maxRetryAttempts !== undefined && dbProvider?.maxRetryAttempts !== null
        ? Number(dbProvider.maxRetryAttempts)
        : null,
    circuitBreakerFailureThreshold: dbProvider?.circuitBreakerFailureThreshold ?? 5,
    circuitBreakerOpenDuration: dbProvider?.circuitBreakerOpenDuration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold: dbProvider?.circuitBreakerHalfOpenSuccessThreshold ?? 2,
    proxyUrl: dbProvider?.proxyUrl ?? null,
    proxyFallbackToDirect: dbProvider?.proxyFallbackToDirect ?? false,
    firstByteTimeoutStreamingMs: dbProvider?.firstByteTimeoutStreamingMs ?? 30000,
    streamingIdleTimeoutMs: dbProvider?.streamingIdleTimeoutMs ?? 10000,
    requestTimeoutNonStreamingMs: dbProvider?.requestTimeoutNonStreamingMs ?? 600000,
    websiteUrl: dbProvider?.websiteUrl ?? null,
    faviconUrl: dbProvider?.faviconUrl ?? null,
    cacheTtlPreference: dbProvider?.cacheTtlPreference ?? null,
    context1mPreference: dbProvider?.context1mPreference ?? null,
    codexReasoningEffortPreference: dbProvider?.codexReasoningEffortPreference ?? null,
    codexReasoningSummaryPreference: dbProvider?.codexReasoningSummaryPreference ?? null,
    codexTextVerbosityPreference: dbProvider?.codexTextVerbosityPreference ?? null,
    codexParallelToolCallsPreference: dbProvider?.codexParallelToolCallsPreference ?? null,
    anthropicMaxTokensPreference: dbProvider?.anthropicMaxTokensPreference ?? null,
    anthropicThinkingBudgetPreference: dbProvider?.anthropicThinkingBudgetPreference ?? null,
    tpm: dbProvider?.tpm ?? null,
    rpm: dbProvider?.rpm ?? null,
    rpd: dbProvider?.rpd ?? null,
    cc: dbProvider?.cc ?? null,
    createdAt: dbProvider?.createdAt ? new Date(dbProvider.createdAt) : new Date(),
    updatedAt: dbProvider?.updatedAt ? new Date(dbProvider.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toMessageRequest(dbMessage: any): MessageRequest {
  return {
    ...dbMessage,
    costMultiplier: dbMessage?.costMultiplier ? parseFloat(dbMessage.costMultiplier) : undefined,
    requestSequence: dbMessage?.requestSequence ?? undefined,
    createdAt: dbMessage?.createdAt ? new Date(dbMessage.createdAt) : new Date(),
    updatedAt: dbMessage?.updatedAt ? new Date(dbMessage.updatedAt) : new Date(),
    costUsd: (() => {
      const formatted = formatCostForStorage(dbMessage?.costUsd);
      return formatted ?? undefined;
    })(),
    cacheCreation5mInputTokens: dbMessage?.cacheCreation5mInputTokens ?? undefined,
    cacheCreation1hInputTokens: dbMessage?.cacheCreation1hInputTokens ?? undefined,
    cacheTtlApplied: dbMessage?.cacheTtlApplied ?? null,
    context1mApplied: dbMessage?.context1mApplied ?? false,
    specialSettings: dbMessage?.specialSettings ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toModelPrice(dbPrice: any): ModelPrice {
  return {
    ...dbPrice,
    source: dbPrice?.source ?? "litellm", // 默认为 litellm（向后兼容）
    createdAt: dbPrice?.createdAt ? new Date(dbPrice.createdAt) : new Date(),
    updatedAt: dbPrice?.updatedAt ? new Date(dbPrice.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toSystemSettings(dbSettings: any): SystemSettings {
  const defaultResponseFixerConfig: ResponseFixerConfig = {
    fixTruncatedJson: true,
    fixSseFormat: true,
    fixEncoding: true,
    maxJsonDepth: 200,
    maxFixSize: 1024 * 1024,
  };

  return {
    id: dbSettings?.id ?? 0,
    siteTitle: dbSettings?.siteTitle ?? "Claude Code Hub",
    allowGlobalUsageView: dbSettings?.allowGlobalUsageView ?? true,
    currencyDisplay: dbSettings?.currencyDisplay ?? "USD",
    billingModelSource: dbSettings?.billingModelSource ?? "original",
    timezone: dbSettings?.timezone ?? null,
    enableAutoCleanup: dbSettings?.enableAutoCleanup ?? false,
    cleanupRetentionDays: dbSettings?.cleanupRetentionDays ?? 30,
    cleanupSchedule: dbSettings?.cleanupSchedule ?? "0 2 * * *",
    cleanupBatchSize: dbSettings?.cleanupBatchSize ?? 10000,
    enableClientVersionCheck: dbSettings?.enableClientVersionCheck ?? false,
    verboseProviderError: dbSettings?.verboseProviderError ?? false,
    enableHttp2: dbSettings?.enableHttp2 ?? false,
    interceptAnthropicWarmupRequests: dbSettings?.interceptAnthropicWarmupRequests ?? false,
    enableThinkingSignatureRectifier: dbSettings?.enableThinkingSignatureRectifier ?? true,
    enableThinkingBudgetRectifier: dbSettings?.enableThinkingBudgetRectifier ?? true,
    enableCodexSessionIdCompletion: dbSettings?.enableCodexSessionIdCompletion ?? true,
    enableResponseFixer: dbSettings?.enableResponseFixer ?? true,
    responseFixerConfig: {
      ...defaultResponseFixerConfig,
      ...(dbSettings?.responseFixerConfig ?? {}),
    },
    quotaDbRefreshIntervalSeconds: dbSettings?.quotaDbRefreshIntervalSeconds ?? 10,
    quotaLeasePercent5h: dbSettings?.quotaLeasePercent5h
      ? parseFloat(dbSettings.quotaLeasePercent5h)
      : 0.05,
    quotaLeasePercentDaily: dbSettings?.quotaLeasePercentDaily
      ? parseFloat(dbSettings.quotaLeasePercentDaily)
      : 0.05,
    quotaLeasePercentWeekly: dbSettings?.quotaLeasePercentWeekly
      ? parseFloat(dbSettings.quotaLeasePercentWeekly)
      : 0.05,
    quotaLeasePercentMonthly: dbSettings?.quotaLeasePercentMonthly
      ? parseFloat(dbSettings.quotaLeasePercentMonthly)
      : 0.05,
    quotaLeaseCapUsd: dbSettings?.quotaLeaseCapUsd ? parseFloat(dbSettings.quotaLeaseCapUsd) : null,
    createdAt: dbSettings?.createdAt ? new Date(dbSettings.createdAt) : new Date(),
    updatedAt: dbSettings?.updatedAt ? new Date(dbSettings.updatedAt) : new Date(),
  };
}
