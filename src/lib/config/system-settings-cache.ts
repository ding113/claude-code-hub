/**
 * System Settings In-Memory Cache
 *
 * Provides a 1-minute TTL cache for system settings to avoid
 * database queries on every proxy request.
 *
 * Features:
 * - In-memory cache (no Redis dependency for read path)
 * - 1-minute TTL for fresh settings
 * - Lazy loading on first access
 * - Manual invalidation when settings are saved
 * - DB 读取失败时优先复用旧缓存，否则回退到保守默认值
 */

import { logger } from "@/lib/logger";
import { getSystemSettings } from "@/repository/system-config";
import type { SystemSettings } from "@/types/system-config";

/** Cache TTL in milliseconds (1 minute) */
const CACHE_TTL_MS = 60 * 1000;

/** Cached settings and timestamp */
let cachedSettings: SystemSettings | null = null;
let cachedAt: number = 0;

/**
 * Read the current in-memory settings cache only.
 * Never triggers a DB refresh.
 */
export function getCachedSystemSettingsOnlyCache(): SystemSettings | null {
  return cachedSettings;
}

/** Default settings used when cache fetch fails */
const DEFAULT_SETTINGS: Pick<
  SystemSettings,
  | "enableHttp2"
  | "enableHighConcurrencyMode"
  | "interceptAnthropicWarmupRequests"
  | "codexPriorityBillingSource"
  | "enableThinkingSignatureRectifier"
  | "enableThinkingBudgetRectifier"
  | "enableBillingHeaderRectifier"
  | "enableResponseInputRectifier"
  | "allowNonConversationEndpointProviderFallback"
  | "enableCodexSessionIdCompletion"
  | "enableClaudeMetadataUserIdInjection"
  | "enableResponseFixer"
  | "responseFixerConfig"
  | "passThroughUpstreamErrorMessage"
  | "publicStatusWindowHours"
  | "publicStatusAggregationIntervalMinutes"
> = {
  enableHttp2: false,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: false,
  codexPriorityBillingSource: "requested",
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  // 安全敏感开关：冷缓存 / DB 读取失败时 fail-closed，避免意外重新开启跨供应商 raw fallback。
  allowNonConversationEndpointProviderFallback: false,
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  passThroughUpstreamErrorMessage: true,
  responseFixerConfig: {
    fixTruncatedJson: true,
    fixSseFormat: true,
    fixEncoding: true,
    maxJsonDepth: 200,
    maxFixSize: 1024 * 1024,
  },
  publicStatusWindowHours: 24,
  publicStatusAggregationIntervalMinutes: 5,
};

/**
 * Get cached system settings
 *
 * Returns cached settings if within TTL, otherwise fetches from database.
 * On fetch failure, returns previous cached value or default settings.
 *
 * @returns System settings (cached or fresh)
 */
export async function getCachedSystemSettings(): Promise<SystemSettings> {
  const now = Date.now();

  // Return cached if still valid
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    // Fetch fresh settings from database
    const settings = await getSystemSettings();

    // Update cache
    cachedSettings = settings;
    cachedAt = now;

    logger.debug("[SystemSettingsCache] Settings cached", {
      enableHttp2: settings.enableHttp2,
      ttl: CACHE_TTL_MS,
    });

    return settings;
  } catch (error) {
    // 优先返回旧缓存；若没有缓存，则回退到保守默认值。
    logger.warn("[SystemSettingsCache] Failed to fetch settings, using fallback", {
      hasCachedValue: !!cachedSettings,
      error,
    });

    if (cachedSettings) {
      return cachedSettings;
    }

    // Return minimal default settings - this should rarely happen
    // since getSystemSettings creates default row if not exists
    return {
      id: 0,
      siteTitle: "Claude Code Hub",
      allowGlobalUsageView: false,
      currencyDisplay: "USD",
      billingModelSource: "original",
      codexPriorityBillingSource: DEFAULT_SETTINGS.codexPriorityBillingSource,
      timezone: null,
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: DEFAULT_SETTINGS.passThroughUpstreamErrorMessage,
      enableAutoCleanup: false,
      cleanupRetentionDays: 30,
      cleanupSchedule: "0 2 * * *",
      cleanupBatchSize: 10000,
      enableClientVersionCheck: false,
      enableHttp2: DEFAULT_SETTINGS.enableHttp2,
      enableHighConcurrencyMode: DEFAULT_SETTINGS.enableHighConcurrencyMode,
      interceptAnthropicWarmupRequests: DEFAULT_SETTINGS.interceptAnthropicWarmupRequests,
      enableThinkingSignatureRectifier: DEFAULT_SETTINGS.enableThinkingSignatureRectifier,
      enableThinkingBudgetRectifier: DEFAULT_SETTINGS.enableThinkingBudgetRectifier,
      enableBillingHeaderRectifier: DEFAULT_SETTINGS.enableBillingHeaderRectifier,
      enableResponseInputRectifier: DEFAULT_SETTINGS.enableResponseInputRectifier,
      allowNonConversationEndpointProviderFallback:
        DEFAULT_SETTINGS.allowNonConversationEndpointProviderFallback,
      enableCodexSessionIdCompletion: DEFAULT_SETTINGS.enableCodexSessionIdCompletion,
      enableClaudeMetadataUserIdInjection: DEFAULT_SETTINGS.enableClaudeMetadataUserIdInjection,
      enableResponseFixer: DEFAULT_SETTINGS.enableResponseFixer,
      responseFixerConfig: DEFAULT_SETTINGS.responseFixerConfig,
      publicStatusWindowHours: DEFAULT_SETTINGS.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes:
        DEFAULT_SETTINGS.publicStatusAggregationIntervalMinutes,
      quotaDbRefreshIntervalSeconds: 10,
      quotaLeasePercent5h: 0.05,
      quotaLeasePercentDaily: 0.05,
      quotaLeasePercentWeekly: 0.05,
      quotaLeasePercentMonthly: 0.05,
      quotaLeaseCapUsd: null,
      ipExtractionConfig: null,
      ipGeoLookupEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies SystemSettings;
  }
}

/**
 * Get only the HTTP/2 enabled setting (optimized for proxy path)
 *
 * @returns Whether HTTP/2 is enabled
 */
export async function isHttp2Enabled(): Promise<boolean> {
  const settings = await getCachedSystemSettings();
  return settings.enableHttp2;
}

/**
 * Invalidate the settings cache
 *
 * Call this when system settings are saved to ensure
 * the next request gets fresh settings.
 */
export function invalidateSystemSettingsCache(): void {
  cachedSettings = null;
  cachedAt = 0;
  logger.info("[SystemSettingsCache] Cache invalidated");
}
