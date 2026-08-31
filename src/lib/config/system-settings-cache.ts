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
import {
  CHANNEL_SYSTEM_SETTINGS_UPDATED,
  publishCacheInvalidation,
  subscribeCacheInvalidation,
} from "@/lib/redis/pubsub";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";
import { REPLAY_CACHE_TTL_MINUTES_DEFAULT } from "@/lib/validation/replay-settings";
import { getSystemSettings } from "@/repository/system-config";
import type { SystemSettings } from "@/types/system-config";
import { getEnvConfig } from "./env.schema";

/** Cache TTL in milliseconds (1 minute) */
const CACHE_TTL_MS = 60 * 1000;
const SUBSCRIPTION_RETRY_MS = 60 * 1000;

/** Cached settings and timestamp */
let cachedSettings: SystemSettings | null = null;
let cachedAt: number = 0;
let cacheVersion = 0;
let subscriptionInitialized = false;
let subscriptionInitPromise: Promise<boolean> | null = null;
let subscriptionNextAttemptAt = 0;

/** Avoid repeating the same invalid environment-variable warning on every request. */
let hasWarnedInvalidResponsesWebsocketEnv = false;
let hasWarnedInvalidStreamGateEnv = false;

function getOpenaiResponsesWebsocketEnvOverride(): boolean | undefined {
  const rawValue = process.env.ENABLE_OPENAI_RESPONSES_WEBSOCKET;

  if (rawValue === undefined) {
    return undefined;
  }

  switch (rawValue) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      if (!hasWarnedInvalidResponsesWebsocketEnv) {
        hasWarnedInvalidResponsesWebsocketEnv = true;
        logger.warn(
          "[SystemSettingsCache] Invalid ENABLE_OPENAI_RESPONSES_WEBSOCKET, using database setting",
          { value: rawValue }
        );
      }
      return undefined;
  }
}

function getFallbackStreamGateMode(): "off" | "shadow" | "enforce" {
  const rawValue = process.env.STREAM_GATE_MODE;
  if (rawValue === "off" || rawValue === "shadow" || rawValue === "enforce") {
    return rawValue;
  }

  try {
    return getEnvConfig().STREAM_GATE_MODE;
  } catch (error) {
    if (!hasWarnedInvalidStreamGateEnv) {
      hasWarnedInvalidStreamGateEnv = true;
      logger.warn("[SystemSettingsCache] Invalid environment fallback, using Stream Gate enforce", {
        error: error instanceof Error ? error.message : String(error),
        value: process.env.STREAM_GATE_MODE,
      });
    }
    return "enforce";
  }
}

/**
 * Read the current in-memory settings cache only.
 * Never triggers a DB refresh.
 */
export function getCachedSystemSettingsOnlyCache(): SystemSettings | null {
  return cachedSettings;
}

/** Default settings used when cache fetch fails */
export const DEFAULT_SETTINGS: Pick<
  SystemSettings,
  | "enableHttp2"
  | "enableOpenaiResponsesWebsocket"
  | "enableHighConcurrencyMode"
  | "interceptAnthropicWarmupRequests"
  | "codexPriorityBillingSource"
  | "enableThinkingSignatureRectifier"
  | "enableThinkingBudgetRectifier"
  | "enableThinkingEffortConflictRectifier"
  | "enableGeminiFunctionIdRectifier"
  | "enableBillingHeaderRectifier"
  | "enableResponseInputRectifier"
  | "allowNonConversationEndpointProviderFallback"
  | "fakeStreamingWhitelist"
  | "enableCodexSessionIdCompletion"
  | "enableClaudeMetadataUserIdInjection"
  | "enableResponseFixer"
  | "responseFixerConfig"
  | "passThroughUpstreamErrorMessage"
  | "publicStatusWindowHours"
  | "publicStatusAggregationIntervalMinutes"
  | "streamGateMode"
  | "affinityIgnoreClientSessionId"
  | "replayCacheTtlMinutes"
  | "discoveryEnabled"
  | "discoveryConcurrency"
  | "maxDiscoveryRounds"
  | "discoverySlaMs"
  | "stickySlaMs"
  | "racingTotalTimeoutMs"
  | "stickyTimeoutCooldownMs"
  | "legacyHedgeMaxInFlight"
> = {
  enableHttp2: false,
  enableOpenaiResponsesWebsocket: true,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: false,
  codexPriorityBillingSource: "requested",
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableThinkingEffortConflictRectifier: true,
  enableGeminiFunctionIdRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  // 安全敏感开关：冷缓存 / DB 读取失败时 fail-closed，避免意外重新开启跨供应商 raw fallback。
  allowNonConversationEndpointProviderFallback: false,
  // Fake streaming 在 DB 完全不可达时 fail-closed（空白名单 → 走原有直传路径），
  // 避免在不确定状态下劫持流式。Transformer / createFallbackSettings 仍走 4 个默认模型。
  fakeStreamingWhitelist: [],
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
  streamGateMode: "enforce",
  affinityIgnoreClientSessionId: true,
  replayCacheTtlMinutes: REPLAY_CACHE_TTL_MINUTES_DEFAULT,
  discoveryEnabled: false,
  discoveryConcurrency: 2,
  maxDiscoveryRounds: 2,
  discoverySlaMs: 10_000,
  stickySlaMs: 20_000,
  racingTotalTimeoutMs: 60_000,
  stickyTimeoutCooldownMs: 300_000,
  legacyHedgeMaxInFlight: 2,
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
  // 多核心启动会在 ready 前等待首次订阅；外部多实例和兼容入口则在首次读取时懒启动。
  startSystemSettingsCacheSubscription();
  const now = Date.now();

  // Return cached if still valid
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const expectedVersion = cacheVersion;
    // Fetch fresh settings from database
    const settings = await getSystemSettings();

    // 更新事件可能发生在查询等待期间。版本已变化时仍允许当前请求使用其查询结果，
    // 但不能让旧快照重新污染后续请求的进程缓存。
    if (cacheVersion === expectedVersion) {
      cachedSettings = settings;
      cachedAt = now;

      logger.debug("[SystemSettingsCache] Settings cached", {
        enableHttp2: settings.enableHttp2,
        ttl: CACHE_TTL_MS,
      });
    }

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
      siteTitle: DEFAULT_SITE_TITLE,
      allowGlobalUsageView: false,
      currencyDisplay: "USD",
      billingModelSource: "original",
      codexPriorityBillingSource: DEFAULT_SETTINGS.codexPriorityBillingSource,
      billNonSuccessfulRequests: false,
      billHedgeLosers: true,
      legacyHedgeMaxInFlight: DEFAULT_SETTINGS.legacyHedgeMaxInFlight,
      timezone: null,
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: DEFAULT_SETTINGS.passThroughUpstreamErrorMessage,
      enableAutoCleanup: false,
      cleanupRetentionDays: 30,
      cleanupSchedule: "0 2 * * *",
      cleanupBatchSize: 10000,
      enableClientVersionCheck: false,
      enableHttp2: DEFAULT_SETTINGS.enableHttp2,
      enableOpenaiResponsesWebsocket: DEFAULT_SETTINGS.enableOpenaiResponsesWebsocket,
      enableHighConcurrencyMode: DEFAULT_SETTINGS.enableHighConcurrencyMode,
      interceptAnthropicWarmupRequests: DEFAULT_SETTINGS.interceptAnthropicWarmupRequests,
      enableThinkingSignatureRectifier: DEFAULT_SETTINGS.enableThinkingSignatureRectifier,
      enableThinkingBudgetRectifier: DEFAULT_SETTINGS.enableThinkingBudgetRectifier,
      enableThinkingEffortConflictRectifier: DEFAULT_SETTINGS.enableThinkingEffortConflictRectifier,
      enableGeminiFunctionIdRectifier: DEFAULT_SETTINGS.enableGeminiFunctionIdRectifier,
      enableBillingHeaderRectifier: DEFAULT_SETTINGS.enableBillingHeaderRectifier,
      enableResponseInputRectifier: DEFAULT_SETTINGS.enableResponseInputRectifier,
      allowNonConversationEndpointProviderFallback:
        DEFAULT_SETTINGS.allowNonConversationEndpointProviderFallback,
      fakeStreamingWhitelist: DEFAULT_SETTINGS.fakeStreamingWhitelist,
      enableCodexSessionIdCompletion: DEFAULT_SETTINGS.enableCodexSessionIdCompletion,
      enableClaudeMetadataUserIdInjection: DEFAULT_SETTINGS.enableClaudeMetadataUserIdInjection,
      enableResponseFixer: DEFAULT_SETTINGS.enableResponseFixer,
      responseFixerConfig: DEFAULT_SETTINGS.responseFixerConfig,
      publicStatusWindowHours: DEFAULT_SETTINGS.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes:
        DEFAULT_SETTINGS.publicStatusAggregationIntervalMinutes,
      streamGateMode: getFallbackStreamGateMode(),
      affinityIgnoreClientSessionId: DEFAULT_SETTINGS.affinityIgnoreClientSessionId,
      replayEnabled: null,
      replayCacheTtlMinutes: DEFAULT_SETTINGS.replayCacheTtlMinutes,
      cacheEffectivenessEnabled: null,
      discoveryEnabled: DEFAULT_SETTINGS.discoveryEnabled,
      discoveryConcurrency: DEFAULT_SETTINGS.discoveryConcurrency,
      maxDiscoveryRounds: DEFAULT_SETTINGS.maxDiscoveryRounds,
      discoverySlaMs: DEFAULT_SETTINGS.discoverySlaMs,
      stickySlaMs: DEFAULT_SETTINGS.stickySlaMs,
      racingTotalTimeoutMs: DEFAULT_SETTINGS.racingTotalTimeoutMs,
      stickyTimeoutCooldownMs: DEFAULT_SETTINGS.stickyTimeoutCooldownMs,
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
 * Get only the OpenAI Responses WebSocket enabled setting.
 * Only effective for Codex-type providers.
 *
 * @returns Whether OpenAI Responses WebSocket support is enabled globally.
 */
export async function isOpenaiResponsesWebsocketEnabled(): Promise<boolean> {
  const envOverride = getOpenaiResponsesWebsocketEnvOverride();
  if (envOverride !== undefined) {
    return envOverride;
  }

  const settings = await getCachedSystemSettings();
  return settings.enableOpenaiResponsesWebsocket;
}

/**
 * Invalidate the settings cache
 *
 * Call this when system settings are saved to ensure
 * the next request gets fresh settings.
 */
function invalidateSystemSettingsCacheLocal(): void {
  cachedSettings = null;
  cachedAt = 0;
  cacheVersion++;
  logger.info("[SystemSettingsCache] Cache invalidated");
}

/**
 * 为当前进程建立系统设置失效订阅。连接暂时不可用时保留 TTL 降级，并以固定
 * 退避避免请求热路径反复创建连接任务。
 */
export async function ensureSystemSettingsCacheSubscription(): Promise<boolean> {
  if (subscriptionInitialized) return true;
  if (subscriptionInitPromise) return subscriptionInitPromise;
  if (Date.now() < subscriptionNextAttemptAt) return false;

  subscriptionInitPromise = (async () => {
    try {
      const cleanup = await subscribeCacheInvalidation(CHANNEL_SYSTEM_SETTINGS_UPDATED, () => {
        invalidateSystemSettingsCacheLocal();
        logger.debug("[SystemSettingsCache] Cache invalidated via pub/sub");
      });
      if (!cleanup) {
        subscriptionNextAttemptAt = Date.now() + SUBSCRIPTION_RETRY_MS;
        return false;
      }

      subscriptionInitialized = true;
      subscriptionNextAttemptAt = 0;
      logger.info("[SystemSettingsCache] Cross-process invalidation enabled");
      return true;
    } catch (error) {
      logger.warn("[SystemSettingsCache] Failed to subscribe to invalidation", {
        error: error instanceof Error ? error.message : String(error),
      });
      subscriptionNextAttemptAt = Date.now() + SUBSCRIPTION_RETRY_MS;
      return false;
    }
  })().finally(() => {
    subscriptionInitPromise = null;
  });

  return subscriptionInitPromise;
}

/** 热路径的无等待入口；只有首次初始化或退避到期时会创建异步任务。 */
export function startSystemSettingsCacheSubscription(): void {
  if (
    subscriptionInitialized ||
    subscriptionInitPromise ||
    Date.now() < subscriptionNextAttemptAt
  ) {
    return;
  }
  void ensureSystemSettingsCacheSubscription();
}

/**
 * 数据库提交后清空本进程缓存，并广播不含设置内容的微小失效消息。发布失败沿用
 * 现有 fail-open 语义，由每进程 60 秒 TTL 提供最终收敛上界。
 */
export function invalidateSystemSettingsCache(): void {
  invalidateSystemSettingsCacheLocal();
  void publishCacheInvalidation(CHANNEL_SYSTEM_SETTINGS_UPDATED);
}
