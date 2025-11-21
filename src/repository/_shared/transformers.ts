import type { User } from "@/types/user";
import type { Key } from "@/types/key";
import type { Provider } from "@/types/provider";
import type { MessageRequest } from "@/types/message";
import type { ModelPrice } from "@/types/model-price";
import type { SystemSettings } from "@/types/system-config";
import { formatCostForStorage } from "@/lib/utils/currency";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toUser(dbUser: any): User {
  return {
    ...dbUser,
    description: dbUser?.description || "",
    role: (dbUser?.role as User["role"]) || "user",
    rpm: dbUser?.rpm || 60,
    dailyQuota: dbUser?.dailyQuota ? parseFloat(dbUser.dailyQuota) : 0,
    providerGroup: dbUser?.providerGroup ?? null,
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
    limitConcurrentSessions: dbKey?.limitConcurrentSessions ?? 0,
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
    modelRedirects: dbProvider?.modelRedirects ?? null,
    codexInstructionsStrategy: dbProvider?.codexInstructionsStrategy ?? "auto",
    limit5hUsd: dbProvider?.limit5hUsd ? parseFloat(dbProvider.limit5hUsd) : null,
    limitDailyUsd: dbProvider?.limitDailyUsd ? parseFloat(dbProvider.limitDailyUsd) : null,
    dailyResetTime: dbProvider?.dailyResetTime ?? "00:00",
    limitWeeklyUsd: dbProvider?.limitWeeklyUsd ? parseFloat(dbProvider.limitWeeklyUsd) : null,
    limitMonthlyUsd: dbProvider?.limitMonthlyUsd ? parseFloat(dbProvider.limitMonthlyUsd) : null,
    limitConcurrentSessions: dbProvider?.limitConcurrentSessions ?? 0,
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
    createdAt: dbMessage?.createdAt ? new Date(dbMessage.createdAt) : new Date(),
    updatedAt: dbMessage?.updatedAt ? new Date(dbMessage.updatedAt) : new Date(),
    costUsd: (() => {
      const formatted = formatCostForStorage(dbMessage?.costUsd);
      return formatted ?? undefined;
    })(),
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
    enableAutoCleanup: dbSettings?.enableAutoCleanup ?? false,
    cleanupRetentionDays: dbSettings?.cleanupRetentionDays ?? 30,
    cleanupSchedule: dbSettings?.cleanupSchedule ?? "0 2 * * *",
    cleanupBatchSize: dbSettings?.cleanupBatchSize ?? 10000,
    enableClientVersionCheck: dbSettings?.enableClientVersionCheck ?? false,
    createdAt: dbSettings?.createdAt ? new Date(dbSettings.createdAt) : new Date(),
    updatedAt: dbSettings?.updatedAt ? new Date(dbSettings.updatedAt) : new Date(),
  };
}
