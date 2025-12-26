import { formatCostForStorage } from "@/lib/utils/currency";
import type { Key } from "@/types/key";
import type { MessageRequest } from "@/types/message";
import type { ModelPrice } from "@/types/model-price";
import type { ModelPriceV2 } from "@/types/model-price-v2";
import type { Provider } from "@/types/provider";
import type { RemoteConfigSync } from "@/types/remote-config";
import type { SystemSettings } from "@/types/system-config";
import type { User } from "@/types/user";
import type { Vendor, VendorEndpoint, VendorKey } from "@/types/vendor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toUser(dbUser: any): User {
  return {
    ...dbUser,
    description: dbUser?.description || "",
    role: (dbUser?.role as User["role"]) || "user",
    rpm: dbUser?.rpm || 60,
    dailyQuota: dbUser?.dailyQuota ? parseFloat(dbUser.dailyQuota) : 0,
    providerGroup: dbUser?.providerGroup ?? null,
    tags: dbUser?.tags ?? [],
    limitTotalUsd:
      dbUser?.limitTotalUsd !== null && dbUser?.limitTotalUsd !== undefined
        ? parseFloat(dbUser.limitTotalUsd)
        : null,
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
    isEnabled: dbProvider?.isEnabled ?? true,
    weight: dbProvider?.weight ?? 1,
    priority: dbProvider?.priority ?? 0,
    costMultiplier: dbProvider?.costMultiplier ? parseFloat(dbProvider.costMultiplier) : 1.0,
    groupTag: dbProvider?.groupTag ?? null,
    providerType: dbProvider?.providerType ?? "claude",
    preserveClientIp: dbProvider?.preserveClientIp ?? false,
    modelRedirects: dbProvider?.modelRedirects ?? null,
    codexInstructionsStrategy: dbProvider?.codexInstructionsStrategy ?? "auto",
    mcpPassthroughType: dbProvider?.mcpPassthroughType ?? "none",
    mcpPassthroughUrl: dbProvider?.mcpPassthroughUrl ?? null,
    limit5hUsd: dbProvider?.limit5hUsd ? parseFloat(dbProvider.limit5hUsd) : null,
    limitDailyUsd: dbProvider?.limitDailyUsd ? parseFloat(dbProvider.limitDailyUsd) : null,
    dailyResetTime: dbProvider?.dailyResetTime ?? "00:00",
    limitWeeklyUsd: dbProvider?.limitWeeklyUsd ? parseFloat(dbProvider.limitWeeklyUsd) : null,
    limitMonthlyUsd: dbProvider?.limitMonthlyUsd ? parseFloat(dbProvider.limitMonthlyUsd) : null,
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
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toModelPrice(dbPrice: any): ModelPrice {
  return {
    ...dbPrice,
    createdAt: dbPrice?.createdAt ? new Date(dbPrice.createdAt) : new Date(),
    updatedAt: dbPrice?.updatedAt ? new Date(dbPrice.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toSystemSettings(dbSettings: any): SystemSettings {
  return {
    id: dbSettings?.id ?? 0,
    siteTitle: dbSettings?.siteTitle ?? "Claude Code Hub",
    allowGlobalUsageView: dbSettings?.allowGlobalUsageView ?? true,
    currencyDisplay: dbSettings?.currencyDisplay ?? "USD",
    billingModelSource: dbSettings?.billingModelSource ?? "original",
    enableAutoCleanup: dbSettings?.enableAutoCleanup ?? false,
    cleanupRetentionDays: dbSettings?.cleanupRetentionDays ?? 30,
    cleanupSchedule: dbSettings?.cleanupSchedule ?? "0 2 * * *",
    cleanupBatchSize: dbSettings?.cleanupBatchSize ?? 10000,
    enableClientVersionCheck: dbSettings?.enableClientVersionCheck ?? false,
    verboseProviderError: dbSettings?.verboseProviderError ?? false,
    enableHttp2: dbSettings?.enableHttp2 ?? false,
    createdAt: dbSettings?.createdAt ? new Date(dbSettings.createdAt) : new Date(),
    updatedAt: dbSettings?.updatedAt ? new Date(dbSettings.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toVendor(dbVendor: any): Vendor {
  return {
    ...dbVendor,
    description: dbVendor?.description ?? null,
    isManaged: dbVendor?.isManaged ?? false,
    isEnabled: dbVendor?.isEnabled ?? true,
    tags: dbVendor?.tags ?? [],
    websiteUrl: dbVendor?.websiteUrl ?? null,
    faviconUrl: dbVendor?.faviconUrl ?? null,
    balanceCheckEnabled: dbVendor?.balanceCheckEnabled ?? false,
    balanceCheckEndpoint: dbVendor?.balanceCheckEndpoint ?? null,
    balanceCheckJsonpath: dbVendor?.balanceCheckJsonpath ?? null,
    balanceCheckIntervalSeconds: dbVendor?.balanceCheckIntervalSeconds ?? null,
    balanceCheckLowThresholdUsd:
      dbVendor?.balanceCheckLowThresholdUsd !== null &&
      dbVendor?.balanceCheckLowThresholdUsd !== undefined
        ? parseFloat(dbVendor.balanceCheckLowThresholdUsd)
        : null,
    createdAt: dbVendor?.createdAt ? new Date(dbVendor.createdAt) : new Date(),
    updatedAt: dbVendor?.updatedAt ? new Date(dbVendor.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toVendorEndpoint(dbEndpoint: any): VendorEndpoint {
  return {
    ...dbEndpoint,
    isEnabled: dbEndpoint?.isEnabled ?? true,
    priority: dbEndpoint?.priority ?? 0,
    latencyMs: dbEndpoint?.latencyMs ?? null,
    healthCheckEnabled: dbEndpoint?.healthCheckEnabled ?? false,
    healthCheckEndpoint: dbEndpoint?.healthCheckEndpoint ?? null,
    healthCheckIntervalSeconds: dbEndpoint?.healthCheckIntervalSeconds ?? null,
    healthCheckTimeoutMs: dbEndpoint?.healthCheckTimeoutMs ?? null,
    healthCheckLastCheckedAt: dbEndpoint?.healthCheckLastCheckedAt
      ? new Date(dbEndpoint.healthCheckLastCheckedAt)
      : null,
    healthCheckLastStatusCode: dbEndpoint?.healthCheckLastStatusCode ?? null,
    healthCheckErrorMessage: dbEndpoint?.healthCheckErrorMessage ?? null,
    createdAt: dbEndpoint?.createdAt ? new Date(dbEndpoint.createdAt) : new Date(),
    updatedAt: dbEndpoint?.updatedAt ? new Date(dbEndpoint.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toVendorKey(dbKey: any): VendorKey {
  return {
    ...dbKey,
    isUserOverride: dbKey?.isUserOverride ?? false,
    balanceUsd:
      dbKey?.balanceUsd !== null && dbKey?.balanceUsd !== undefined
        ? parseFloat(dbKey.balanceUsd)
        : null,
    balanceUpdatedAt: dbKey?.balanceUpdatedAt ? new Date(dbKey.balanceUpdatedAt) : null,
    isEnabled: dbKey?.isEnabled ?? true,
    weight: dbKey?.weight ?? 1,
    priority: dbKey?.priority ?? 0,
    costMultiplier: dbKey?.costMultiplier ? parseFloat(dbKey.costMultiplier) : 1.0,
    groupTag: dbKey?.groupTag ?? null,
    providerType: dbKey?.providerType ?? "claude",
    preserveClientIp: dbKey?.preserveClientIp ?? false,
    modelRedirects: dbKey?.modelRedirects ?? null,
    allowedModels: dbKey?.allowedModels ?? null,
    joinClaudePool: dbKey?.joinClaudePool ?? false,
    codexInstructionsStrategy: dbKey?.codexInstructionsStrategy ?? "auto",
    mcpPassthroughType: dbKey?.mcpPassthroughType ?? "none",
    mcpPassthroughUrl: dbKey?.mcpPassthroughUrl ?? null,
    limit5hUsd: dbKey?.limit5hUsd ? parseFloat(dbKey.limit5hUsd) : null,
    limitDailyUsd: dbKey?.limitDailyUsd ? parseFloat(dbKey.limitDailyUsd) : null,
    dailyResetMode: dbKey?.dailyResetMode ?? "fixed",
    dailyResetTime: dbKey?.dailyResetTime ?? "00:00",
    limitWeeklyUsd: dbKey?.limitWeeklyUsd ? parseFloat(dbKey.limitWeeklyUsd) : null,
    limitMonthlyUsd: dbKey?.limitMonthlyUsd ? parseFloat(dbKey.limitMonthlyUsd) : null,
    limitConcurrentSessions: dbKey?.limitConcurrentSessions ?? 0,
    maxRetryAttempts:
      dbKey?.maxRetryAttempts !== undefined && dbKey?.maxRetryAttempts !== null
        ? Number(dbKey.maxRetryAttempts)
        : null,
    circuitBreakerFailureThreshold: dbKey?.circuitBreakerFailureThreshold ?? 5,
    circuitBreakerOpenDuration: dbKey?.circuitBreakerOpenDuration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold: dbKey?.circuitBreakerHalfOpenSuccessThreshold ?? 2,
    proxyUrl: dbKey?.proxyUrl ?? null,
    proxyFallbackToDirect: dbKey?.proxyFallbackToDirect ?? false,
    firstByteTimeoutStreamingMs: dbKey?.firstByteTimeoutStreamingMs ?? 30000,
    streamingIdleTimeoutMs: dbKey?.streamingIdleTimeoutMs ?? 10000,
    requestTimeoutNonStreamingMs: dbKey?.requestTimeoutNonStreamingMs ?? 600000,
    websiteUrl: dbKey?.websiteUrl ?? null,
    faviconUrl: dbKey?.faviconUrl ?? null,
    cacheTtlPreference: dbKey?.cacheTtlPreference ?? null,
    context1mPreference: dbKey?.context1mPreference ?? null,
    tpm: dbKey?.tpm ?? null,
    rpm: dbKey?.rpm ?? null,
    rpd: dbKey?.rpd ?? null,
    cc: dbKey?.cc ?? null,
    createdAt: dbKey?.createdAt ? new Date(dbKey.createdAt) : new Date(),
    updatedAt: dbKey?.updatedAt ? new Date(dbKey.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toModelPriceV2(dbPrice: any): ModelPriceV2 {
  return {
    ...dbPrice,
    remoteVersion: dbPrice?.remoteVersion ?? null,
    createdAt: dbPrice?.createdAt ? new Date(dbPrice.createdAt) : new Date(),
    updatedAt: dbPrice?.updatedAt ? new Date(dbPrice.updatedAt) : new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toRemoteConfigSync(dbRecord: any): RemoteConfigSync {
  return {
    ...dbRecord,
    remoteVersion: dbRecord?.remoteVersion ?? null,
    lastAttemptAt: dbRecord?.lastAttemptAt ? new Date(dbRecord.lastAttemptAt) : null,
    lastSyncedAt: dbRecord?.lastSyncedAt ? new Date(dbRecord.lastSyncedAt) : null,
    lastErrorMessage: dbRecord?.lastErrorMessage ?? null,
    createdAt: dbRecord?.createdAt ? new Date(dbRecord.createdAt) : new Date(),
    updatedAt: dbRecord?.updatedAt ? new Date(dbRecord.updatedAt) : new Date(),
  };
}
