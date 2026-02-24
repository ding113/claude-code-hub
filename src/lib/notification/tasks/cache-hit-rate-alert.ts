import { addDays, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  type CacheHitRateAlertDecisionSettings,
  type CacheHitRateAlertMetric,
  decideCacheHitRateAnomalies,
} from "@/lib/cache-hit-rate-alert/decision";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type {
  CacheHitRateAlertData,
  CacheHitRateAlertSettingsSnapshot,
  CacheHitRateAlertWindow,
} from "@/lib/webhook";
import { findProviderModelCacheHitRateMetricsForAlert } from "@/repository/cache-hit-rate-alert";
import { getNotificationSettings } from "@/repository/notifications";
import { findAllProviders } from "@/repository/provider";

export interface CacheHitRateAlertTaskResult {
  payload: CacheHitRateAlertData;
  dedupKeysToSet: string[];
  cooldownMinutes: number;
}

function parseNumber(input: string | null | undefined, fallback: number): number {
  if (input === null || input === undefined) return fallback;
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function parseIntNumber(input: number | null | undefined, fallback: number): number {
  if (input === null || input === undefined) return fallback;
  const value = Number(input);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function resolveWindowMode(
  mode: string | null | undefined,
  intervalMinutes: number
): {
  mode: string;
  durationMinutes: number;
} {
  switch (mode) {
    case "5m":
      return { mode: "5m", durationMinutes: 5 };
    case "30m":
      return { mode: "30m", durationMinutes: 30 };
    case "1h":
      return { mode: "1h", durationMinutes: 60 };
    case "1.5h":
      return { mode: "1.5h", durationMinutes: 90 };
    default: {
      if (intervalMinutes <= 5) return { mode: "5m", durationMinutes: 5 };
      if (intervalMinutes <= 30) return { mode: "30m", durationMinutes: 30 };
      if (intervalMinutes <= 60) return { mode: "1h", durationMinutes: 60 };
      return { mode: "1.5h", durationMinutes: 90 };
    }
  }
}

function buildRedisKeyPart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function buildCooldownKey(params: {
  providerId: number;
  model: string;
  windowMode: string;
}): string {
  return [
    "cache-hit-rate-alert",
    "v1",
    String(params.providerId),
    buildRedisKeyPart(params.model),
    params.windowMode,
  ].join(":");
}

function toDecisionMetric(
  row: Awaited<ReturnType<typeof findProviderModelCacheHitRateMetricsForAlert>>[number]
): CacheHitRateAlertMetric {
  return {
    providerId: row.providerId,
    model: row.model,
    totalRequests: row.totalRequests,
    denominatorTokens: row.denominatorTokens,
    hitRateTokens: row.hitRateTokens,
    eligibleRequests: row.eligibleRequests,
    eligibleDenominatorTokens: row.eligibleDenominatorTokens,
    hitRateTokensEligible: row.hitRateTokensEligible,
  };
}

async function getStartOfToday(timezone: string, now: Date): Promise<Date> {
  const zonedNow = toZonedTime(now, timezone);
  const zonedStart = startOfDay(zonedNow);
  return fromZonedTime(zonedStart, timezone);
}

export async function generateCacheHitRateAlertPayload(): Promise<CacheHitRateAlertTaskResult | null> {
  const settings = await getNotificationSettings();

  if (!settings.enabled || !settings.cacheHitRateAlertEnabled) {
    logger.info({ action: "cache_hit_rate_alert_disabled" });
    return null;
  }

  const intervalMinutes = parseIntNumber(settings.cacheHitRateAlertCheckInterval, 5);
  const lookbackDays = parseIntNumber(settings.cacheHitRateAlertHistoricalLookbackDays, 7);
  const cooldownMinutes = parseIntNumber(settings.cacheHitRateAlertCooldownMinutes, 30);

  const decisionSettings: CacheHitRateAlertDecisionSettings = {
    absMin: parseNumber(settings.cacheHitRateAlertAbsMin, 0.05),
    dropRel: parseNumber(settings.cacheHitRateAlertDropRel, 0.3),
    dropAbs: parseNumber(settings.cacheHitRateAlertDropAbs, 0.1),
    minEligibleRequests: parseIntNumber(settings.cacheHitRateAlertMinEligibleRequests, 20),
    minEligibleTokens: parseIntNumber(settings.cacheHitRateAlertMinEligibleTokens, 0),
    topN: parseIntNumber(settings.cacheHitRateAlertTopN, 10),
  };

  const { mode: resolvedWindowMode, durationMinutes } = resolveWindowMode(
    settings.cacheHitRateAlertWindowMode,
    intervalMinutes
  );

  const now = new Date();
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - durationMinutes * 60 * 1000);
  const prevStart = new Date(now.getTime() - durationMinutes * 2 * 60 * 1000);
  const prevEnd = currentStart;

  const timezone = await resolveSystemTimezone();
  const todayStart = await getStartOfToday(timezone, now);
  const historicalStartZoned = addDays(toZonedTime(todayStart, timezone), -lookbackDays);
  const historicalStart = fromZonedTime(historicalStartZoned, timezone);
  const historicalEnd = todayStart;

  const todayEnd = currentStart;

  logger.info({
    action: "cache_hit_rate_alert_generate_start",
    windowMode: resolvedWindowMode,
    durationMinutes,
    intervalMinutes,
    lookbackDays,
    cooldownMinutes,
    decisionSettings,
    timezone,
  });

  const [currentRows, prevRows, todayRows, historicalRows] = await Promise.all([
    findProviderModelCacheHitRateMetricsForAlert(
      { start: currentStart, end: currentEnd },
      undefined,
      {
        windowMode: "rolling",
        statusCodeMode: "2xx",
      }
    ),
    findProviderModelCacheHitRateMetricsForAlert({ start: prevStart, end: prevEnd }, undefined, {
      windowMode: "rolling",
      statusCodeMode: "2xx",
    }),
    todayStart < todayEnd
      ? findProviderModelCacheHitRateMetricsForAlert(
          { start: todayStart, end: todayEnd },
          undefined,
          {
            windowMode: "rolling",
            statusCodeMode: "2xx",
          }
        )
      : Promise.resolve([]),
    historicalStart < historicalEnd
      ? findProviderModelCacheHitRateMetricsForAlert(
          { start: historicalStart, end: historicalEnd },
          undefined,
          { windowMode: "rolling", statusCodeMode: "2xx" }
        )
      : Promise.resolve([]),
  ]);

  const anomalies = decideCacheHitRateAnomalies({
    current: currentRows.map(toDecisionMetric),
    prev: prevRows.map(toDecisionMetric),
    today: todayRows.map(toDecisionMetric),
    historical: historicalRows.map(toDecisionMetric),
    settings: decisionSettings,
  });

  if (anomalies.length === 0) {
    logger.info({
      action: "cache_hit_rate_alert_no_anomalies",
      windowMode: resolvedWindowMode,
      durationMinutes,
    });
    return null;
  }

  const redis = cooldownMinutes > 0 ? getRedisClient({ allowWhenRateLimitDisabled: true }) : null;
  const suppressedKeys = new Set<string>();

  if (redis) {
    for (const anomaly of anomalies) {
      const key = buildCooldownKey({
        providerId: anomaly.providerId,
        model: anomaly.model,
        windowMode: resolvedWindowMode,
      });
      try {
        const cached = await redis.get(key);
        if (cached) {
          suppressedKeys.add(key);
        }
      } catch (error) {
        logger.warn({
          action: "cache_hit_rate_alert_dedup_read_failed",
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const suppressedCount = suppressedKeys.size;
  const remaining = anomalies.filter(
    (a) =>
      !suppressedKeys.has(
        buildCooldownKey({
          providerId: a.providerId,
          model: a.model,
          windowMode: resolvedWindowMode,
        })
      )
  );

  if (remaining.length === 0) {
    logger.info({
      action: "cache_hit_rate_alert_all_suppressed",
      suppressedCount,
      windowMode: resolvedWindowMode,
      durationMinutes,
      cooldownMinutes,
    });
    return null;
  }

  const providers = await findAllProviders();
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const window: CacheHitRateAlertWindow = {
    mode: resolvedWindowMode,
    startTime: currentStart.toISOString(),
    endTime: currentEnd.toISOString(),
    durationMinutes,
  };

  const settingsSnapshot: CacheHitRateAlertSettingsSnapshot = {
    windowMode: settings.cacheHitRateAlertWindowMode ?? "auto",
    checkIntervalMinutes: intervalMinutes,
    historicalLookbackDays: lookbackDays,
    minEligibleRequests: decisionSettings.minEligibleRequests,
    minEligibleTokens: decisionSettings.minEligibleTokens,
    absMin: decisionSettings.absMin,
    dropRel: decisionSettings.dropRel,
    dropAbs: decisionSettings.dropAbs,
    cooldownMinutes,
    topN: decisionSettings.topN,
  };

  const payload: CacheHitRateAlertData = {
    window,
    anomalies: remaining.map((a) => {
      const provider = providerMap.get(a.providerId);
      return {
        providerId: a.providerId,
        providerName: provider?.name,
        providerType: provider?.providerType,
        model: a.model,
        baselineSource: a.baselineSource,
        current: a.current,
        baseline: a.baseline,
        deltaAbs: a.deltaAbs,
        deltaRel: a.deltaRel,
        dropAbs: a.dropAbs,
        reasonCodes: a.reasonCodes,
      };
    }),
    suppressedCount,
    settings: settingsSnapshot,
    generatedAt: new Date().toISOString(),
  };

  const dedupKeysToSet = payload.anomalies.map((a) =>
    buildCooldownKey({
      providerId: a.providerId,
      model: a.model,
      windowMode: resolvedWindowMode,
    })
  );

  logger.info({
    action: "cache_hit_rate_alert_generated",
    windowMode: resolvedWindowMode,
    durationMinutes,
    anomalies: payload.anomalies.length,
    suppressedCount,
  });

  return { payload, dedupKeysToSet, cooldownMinutes };
}

export async function commitCacheHitRateAlertCooldown(
  keys: string[],
  cooldownMinutes: number
): Promise<void> {
  if (keys.length === 0) return;
  if (cooldownMinutes <= 0) return;

  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis) return;

  const ttlSeconds = Math.max(1, cooldownMinutes * 60);
  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.set(key, "1", "EX", ttlSeconds);
  }

  try {
    await pipeline.exec();
  } catch (error) {
    logger.warn({
      action: "cache_hit_rate_alert_dedup_write_failed",
      keysCount: keys.length,
      cooldownMinutes,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
