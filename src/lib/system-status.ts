import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import { queryProviderAvailability } from "@/lib/availability";
import { getLeaderboardWithCache } from "@/lib/redis";
import type { CurrencyCode } from "@/lib/utils";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type {
  ProviderCacheHitRateLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";
import { getSystemSettings } from "@/repository/system-config";
import type { ProviderType } from "@/types/provider";

const STATUS_PRIORITY = {
  red: 0,
  unknown: 1,
  green: 2,
} as const;

export const PUBLIC_SYSTEM_STATUS_WINDOW_DAYS = 7;
export const PUBLIC_SYSTEM_STATUS_BUCKETS = 60;

interface PublicSystemStatusBucket {
  bucketStart: string;
  availabilityScore: number;
  totalRequests: number;
}

export interface PublicSystemStatusProvider {
  providerId: number;
  providerName: string;
  providerType: ProviderType;
  currentStatus: "green" | "red" | "unknown";
  availability: number;
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  lastRequestAt: string | null;
  cacheHitRate: number | null;
  avgTokensPerSecond: number | null;
  avgCostPerMillionTokens: number | null;
  avgCostPerHundredMillionTokens: number | null;
  history: PublicSystemStatusBucket[];
}

export interface PublicSystemStatusSummary {
  systemAvailability: number;
  providerCount: number;
  healthyCount: number;
  degradedCount: number;
  unknownCount: number;
  weightedCacheHitRate: number | null;
  weightedTokensPerSecond: number | null;
  weightedCostPerMillionTokens: number | null;
  weightedCostPerHundredMillionTokens: number | null;
}

export interface PublicSystemStatusSnapshot {
  queriedAt: string;
  startTime: string;
  endTime: string;
  currencyDisplay: CurrencyCode;
  windowDays: number;
  bucketSizeMinutes: number;
  summary: PublicSystemStatusSummary;
  providers: PublicSystemStatusProvider[];
}

function toHundredMillionCost(value: number | null | undefined): number | null {
  return value == null ? null : value * 100;
}

function buildRollingDateRange(now: Date, timezone: string) {
  const start = new Date(
    now.getTime() - (PUBLIC_SYSTEM_STATUS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000
  );
  return {
    startDate: formatInTimeZone(start, timezone, "yyyy-MM-dd"),
    endDate: formatInTimeZone(now, timezone, "yyyy-MM-dd"),
  };
}

function computeWeightedAverage<T>(
  entries: T[],
  valueSelector: (entry: T) => number | null | undefined,
  weightSelector: (entry: T) => number | null | undefined
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const entry of entries) {
    const value = valueSelector(entry);
    const weight = weightSelector(entry) ?? 0;
    if (value == null || !Number.isFinite(value) || weight <= 0) {
      continue;
    }
    weightedSum += value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function sortProviders(a: PublicSystemStatusProvider, b: PublicSystemStatusProvider) {
  const statusDelta = STATUS_PRIORITY[a.currentStatus] - STATUS_PRIORITY[b.currentStatus];
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const availabilityDelta = a.availability - b.availability;
  if (availabilityDelta !== 0) {
    return availabilityDelta;
  }

  return a.providerName.localeCompare(b.providerName);
}

export async function getPublicSystemStatusSnapshot(
  now = new Date()
): Promise<PublicSystemStatusSnapshot> {
  const [settings, timezone] = await Promise.all([getSystemSettings(), resolveSystemTimezone()]);
  const dateRange = buildRollingDateRange(now, timezone);

  const [availabilityResult, providerRowsRaw, cacheRowsRaw] = await Promise.all([
    queryProviderAvailability({
      startTime: new Date(now.getTime() - PUBLIC_SYSTEM_STATUS_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      endTime: now,
      includeDisabled: false,
      maxBuckets: PUBLIC_SYSTEM_STATUS_BUCKETS,
    }),
    getLeaderboardWithCache("custom", settings.currencyDisplay, "provider", dateRange),
    getLeaderboardWithCache("custom", settings.currencyDisplay, "providerCacheHitRate", dateRange),
  ]);

  const providerRows = providerRowsRaw as ProviderLeaderboardEntry[];
  const cacheRows = cacheRowsRaw as ProviderCacheHitRateLeaderboardEntry[];

  const providerMetrics = new Map(providerRows.map((entry) => [entry.providerId, entry]));
  const cacheMetrics = new Map(cacheRows.map((entry) => [entry.providerId, entry]));

  const providers = availabilityResult.providers
    .map<PublicSystemStatusProvider>((provider) => {
      const providerRow = providerMetrics.get(provider.providerId);
      const cacheRow = cacheMetrics.get(provider.providerId);
      const avgCostPerMillionTokens = providerRow?.avgCostPerMillionTokens ?? null;

      return {
        providerId: provider.providerId,
        providerName: provider.providerName,
        providerType: provider.providerType as ProviderType,
        currentStatus: provider.currentStatus,
        availability: provider.currentAvailability,
        totalRequests: provider.totalRequests,
        successRate: provider.successRate,
        avgLatencyMs: provider.avgLatencyMs,
        lastRequestAt: provider.lastRequestAt,
        cacheHitRate: cacheRow?.cacheHitRate ?? null,
        avgTokensPerSecond: providerRow?.avgTokensPerSecond ?? null,
        avgCostPerMillionTokens,
        avgCostPerHundredMillionTokens: toHundredMillionCost(avgCostPerMillionTokens),
        history: provider.timeBuckets.map((bucket) => ({
          bucketStart: bucket.bucketStart,
          availabilityScore: bucket.availabilityScore,
          totalRequests: bucket.totalRequests,
        })),
      };
    })
    .sort(sortProviders);

  const summary: PublicSystemStatusSummary = {
    systemAvailability: availabilityResult.systemAvailability,
    providerCount: providers.length,
    healthyCount: providers.filter((provider) => provider.currentStatus === "green").length,
    degradedCount: providers.filter((provider) => provider.currentStatus === "red").length,
    unknownCount: providers.filter((provider) => provider.currentStatus === "unknown").length,
    weightedCacheHitRate: computeWeightedAverage(
      providers,
      (provider) => provider.cacheHitRate,
      (provider) => provider.totalRequests
    ),
    weightedTokensPerSecond: computeWeightedAverage(
      providers,
      (provider) => provider.avgTokensPerSecond,
      (provider) => provider.totalRequests
    ),
    weightedCostPerMillionTokens: computeWeightedAverage(
      providers,
      (provider) => provider.avgCostPerMillionTokens,
      (provider) => provider.totalRequests
    ),
    weightedCostPerHundredMillionTokens: computeWeightedAverage(
      providers,
      (provider) => provider.avgCostPerHundredMillionTokens,
      (provider) => provider.totalRequests
    ),
  };

  return {
    queriedAt: availabilityResult.queriedAt,
    startTime: availabilityResult.startTime,
    endTime: availabilityResult.endTime,
    currencyDisplay: settings.currencyDisplay,
    windowDays: PUBLIC_SYSTEM_STATUS_WINDOW_DAYS,
    bucketSizeMinutes: availabilityResult.bucketSizeMinutes,
    summary,
    providers,
  };
}

export { toHundredMillionCost };
