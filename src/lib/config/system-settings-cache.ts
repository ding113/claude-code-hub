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
 * - Fail-open: returns default settings on error
 */

import "server-only";

import { logger } from "@/lib/logger";
import { publishCacheInvalidation, subscribeCacheInvalidation } from "@/lib/redis/pubsub";
import { getSystemSettings } from "@/repository/system-config";
import type { SystemSettings } from "@/types/system-config";

/** Cache TTL in milliseconds (1 minute) */
const CACHE_TTL_MS = 60 * 1000;

export const CHANNEL_SYSTEM_SETTINGS_UPDATED = "cch:cache:system_settings:updated";

/** Cached settings and timestamp */
let cachedSettings: SystemSettings | null = null;
let cachedAt: number = 0;

/**
 * In-flight fetch promise (dedupe concurrent cache misses)
 *
 * This avoids thundering herd on cold start / TTL boundary.
 */
let inFlightFetch: Promise<SystemSettings> | null = null;

/**
 * Cache generation id
 *
 * Incremented on invalidation to prevent stale in-flight fetches from overwriting newer cache.
 */
let cacheGeneration = 0;

/** Default settings used when cache fetch fails */
const DEFAULT_SETTINGS: Pick<
  SystemSettings,
  | "enableHttp2"
  | "interceptAnthropicWarmupRequests"
  | "enableThinkingSignatureRectifier"
  | "enableThinkingBudgetRectifier"
  | "enableBillingHeaderRectifier"
  | "enableCodexSessionIdCompletion"
  | "enableClaudeMetadataUserIdInjection"
  | "enableResponseFixer"
  | "responseFixerConfig"
> = {
  enableHttp2: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  responseFixerConfig: {
    fixTruncatedJson: true,
    fixSseFormat: true,
    fixEncoding: true,
    maxJsonDepth: 200,
    maxFixSize: 1024 * 1024,
  },
};

let subscriptionInitialized = false;
let subscriptionInitPromise: Promise<void> | null = null;

async function ensureSubscription(): Promise<void> {
  if (subscriptionInitialized) return;
  if (subscriptionInitPromise) return subscriptionInitPromise;

  subscriptionInitPromise = (async () => {
    // CI/build 阶段跳过，避免触发 Redis 连接
    if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
      subscriptionInitialized = true;
      return;
    }

    const redisUrl = process.env.REDIS_URL?.trim();
    const rateLimitRaw = process.env.ENABLE_RATE_LIMIT?.trim();
    const isRateLimitEnabled = rateLimitRaw !== "false" && rateLimitRaw !== "0";

    // Redis 不可用或未启用（当前 pubsub 实现依赖 ENABLE_RATE_LIMIT=true）
    if (!redisUrl || !isRateLimitEnabled) {
      subscriptionInitialized = true;
      return;
    }

    try {
      const cleanup = await subscribeCacheInvalidation(CHANNEL_SYSTEM_SETTINGS_UPDATED, () => {
        invalidateSystemSettingsCache();
        logger.debug("[SystemSettingsCache] Cache invalidated via pub/sub");
      });

      if (!cleanup) return;

      subscriptionInitialized = true;
    } catch (error) {
      logger.warn("[SystemSettingsCache] Failed to subscribe settings invalidation", { error });
    }
  })().finally(() => {
    subscriptionInitPromise = null;
  });

  return subscriptionInitPromise;
}

/**
 * Get cached system settings
 *
 * Returns cached settings if within TTL, otherwise fetches from database.
 * On fetch failure, returns previous cached value or default settings.
 *
 * @returns System settings (cached or fresh)
 */
export async function getCachedSystemSettings(): Promise<SystemSettings> {
  // 不阻塞：尽力初始化跨实例失效通知订阅
  void ensureSubscription();

  const now = Date.now();

  // Return cached if still valid
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  // Dedupe concurrent cache misses
  if (inFlightFetch) {
    return inFlightFetch;
  }

  const generationAtStart = cacheGeneration;

  const fetchPromise = (async (): Promise<SystemSettings> => {
    try {
      // Fetch fresh settings from database
      const settings = await getSystemSettings();

      // Update cache only if generation unchanged
      if (cacheGeneration === generationAtStart) {
        cachedSettings = settings;
        cachedAt = Date.now();
        logger.debug("[SystemSettingsCache] Settings cached", {
          enableHttp2: settings.enableHttp2,
          ttl: CACHE_TTL_MS,
        });
      }

      return settings;
    } catch (error) {
      // Fail-open: return previous cached value or defaults
      logger.warn("[SystemSettingsCache] Failed to fetch settings, using fallback", {
        hasCachedValue: !!cachedSettings,
        error,
      });

      const fallback: SystemSettings =
        cachedSettings ??
        ({
          // Return minimal default settings - this should rarely happen
          // since getSystemSettings creates default row if not exists
          id: 0,
          siteTitle: "Claude Code Hub",
          allowGlobalUsageView: false,
          currencyDisplay: "USD",
          billingModelSource: "original",
          timezone: null,
          verboseProviderError: false,
          enableAutoCleanup: false,
          cleanupRetentionDays: 30,
          cleanupSchedule: "0 2 * * *",
          cleanupBatchSize: 10000,
          enableClientVersionCheck: false,
          enableHttp2: DEFAULT_SETTINGS.enableHttp2,
          interceptAnthropicWarmupRequests: DEFAULT_SETTINGS.interceptAnthropicWarmupRequests,
          enableThinkingSignatureRectifier: DEFAULT_SETTINGS.enableThinkingSignatureRectifier,
          enableThinkingBudgetRectifier: DEFAULT_SETTINGS.enableThinkingBudgetRectifier,
          enableBillingHeaderRectifier: DEFAULT_SETTINGS.enableBillingHeaderRectifier,
          enableCodexSessionIdCompletion: DEFAULT_SETTINGS.enableCodexSessionIdCompletion,
          enableClaudeMetadataUserIdInjection: DEFAULT_SETTINGS.enableClaudeMetadataUserIdInjection,
          enableResponseFixer: DEFAULT_SETTINGS.enableResponseFixer,
          responseFixerConfig: DEFAULT_SETTINGS.responseFixerConfig,
          quotaDbRefreshIntervalSeconds: 10,
          quotaLeasePercent5h: 0.05,
          quotaLeasePercentDaily: 0.05,
          quotaLeasePercentWeekly: 0.05,
          quotaLeasePercentMonthly: 0.05,
          quotaLeaseCapUsd: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } satisfies SystemSettings);

      // 将 fallback 也写入缓存，避免在 DB 不可用时每次调用都重复打点/重试
      if (cacheGeneration === generationAtStart) {
        cachedSettings = fallback;
        cachedAt = Date.now();
      }

      return fallback;
    }
  })();

  inFlightFetch = fetchPromise;

  try {
    return await fetchPromise;
  } finally {
    if (inFlightFetch === fetchPromise) {
      inFlightFetch = null;
    }
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
  cacheGeneration++;
  cachedSettings = null;
  cachedAt = 0;
  inFlightFetch = null;
  logger.info("[SystemSettingsCache] Cache invalidated");
}

/**
 * Invalidate settings cache and publish cross-instance invalidation notification.
 *
 * Use this after system settings are saved.
 */
export async function publishSystemSettingsCacheInvalidation(): Promise<void> {
  invalidateSystemSettingsCache();

  const redisUrl = process.env.REDIS_URL?.trim();
  const rateLimitRaw = process.env.ENABLE_RATE_LIMIT?.trim();
  const isRateLimitEnabled = rateLimitRaw !== "false" && rateLimitRaw !== "0";

  if (!redisUrl || !isRateLimitEnabled) return;

  await publishCacheInvalidation(CHANNEL_SYSTEM_SETTINGS_UPDATED);
  logger.debug("[SystemSettingsCache] Published cache invalidation");
}
