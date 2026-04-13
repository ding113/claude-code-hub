/**
 * Provider Availability Aggregation Service
 * Calculates availability metrics from request logs
 * Simple two-tier status: success (green) or failure (red)
 */

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest, providers } from "@/drizzle/schema";
import type {
  AvailabilityQueryOptions,
  AvailabilityQueryResult,
  AvailabilityStatus,
  ProviderAvailabilitySummary,
  RequestStatusClassification,
  TimeBucketMetrics,
} from "./types";

type AggregatedAvailabilityBucketRow = {
  providerId: number;
  bucketStart: Date;
  totalRequests: number;
  greenCount: number;
  redCount: number;
  latencyCount: number;
  latencySumMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  lastRequestAt: Date | null;
};

type AggregatedCurrentProviderStatusRow = {
  providerId: number;
  greenCount: number;
  redCount: number;
  lastRequestAt: Date | null;
};

function buildAvailabilityFinalizedCondition() {
  return isNotNull(messageRequest.statusCode);
}

function buildTimestampLowerBound(column: typeof messageRequest.createdAt, date: Date) {
  return sql`${column} >= CAST(${date.toISOString()} AS timestamptz)`;
}

function buildTimestampUpperBound(column: typeof messageRequest.createdAt, date: Date) {
  return sql`${column} <= CAST(${date.toISOString()} AS timestamptz)`;
}

function buildAvailabilityRequestConditions(input: {
  providerIds: number[];
  startDate: Date;
  endDate?: Date;
}) {
  const conditions = [
    inArray(messageRequest.providerId, input.providerIds),
    buildTimestampLowerBound(messageRequest.createdAt, input.startDate),
    isNull(messageRequest.deletedAt),
    buildAvailabilityFinalizedCondition(),
  ];

  if (input.endDate) {
    conditions.push(buildTimestampUpperBound(messageRequest.createdAt, input.endDate));
  }

  return and(...conditions);
}

function toFiniteNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getTimeValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Classify a single finalized request's status
 * Simple: success (2xx/3xx) = green, failure = red
 */
export function classifyRequestStatus(statusCode: number): RequestStatusClassification {
  // 仅把 2xx/3xx 视为成功；1xx 不应在可用性里被计为绿色。
  if (statusCode >= 200 && statusCode < 400) {
    return {
      status: "green",
      isSuccess: true,
      isError: false,
    };
  }

  return {
    status: "red",
    isSuccess: false,
    isError: true,
  };
}

/**
 * Calculate availability score from counts (simple: green / total)
 */
export function calculateAvailabilityScore(greenCount: number, redCount: number): number {
  const total = greenCount + redCount;
  if (total === 0) return 0;

  return greenCount / total;
}

/**
 * Determine optimal time bucket size based on data density
 */
export function determineOptimalBucketSize(
  _totalRequests: number,
  timeRangeMinutes: number
): number {
  // Target: 20-100 data points per time series for good visualization
  const targetBuckets = 50;
  const idealBucketMinutes = timeRangeMinutes / targetBuckets;

  // Round to nearest standard bucket size
  const standardSizes = [1, 5, 15, 60, 1440]; // 1min, 5min, 15min, 1hour, 1day

  for (const size of standardSizes) {
    if (idealBucketMinutes <= size) {
      return size;
    }
  }

  return 1440; // Default to daily for very long ranges
}

/**
 * Query availability data for providers
 */
export async function queryProviderAvailability(
  options: AvailabilityQueryOptions = {}
): Promise<AvailabilityQueryResult> {
  const now = new Date();
  const {
    startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000), // Default: last 24 hours
    endTime = now,
    providerIds = [],
    bucketSizeMinutes: explicitBucketSize,
    includeDisabled = false,
    maxBuckets = 100,
  } = options;

  const startDate = typeof startTime === "string" ? new Date(startTime) : startTime;
  const endDate = typeof endTime === "string" ? new Date(endTime) : endTime;
  const timeRangeMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);

  // Get provider list
  const providerConditions = [isNull(providers.deletedAt)];
  if (!includeDisabled) {
    providerConditions.push(eq(providers.isEnabled, true));
  }
  if (providerIds.length > 0) {
    providerConditions.push(inArray(providers.id, providerIds));
  }

  const providerList = await db
    .select({
      id: providers.id,
      name: providers.name,
      providerType: providers.providerType,
      enabled: providers.isEnabled,
    })
    .from(providers)
    .where(and(...providerConditions));

  if (providerList.length === 0) {
    return {
      queriedAt: now.toISOString(),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      bucketSizeMinutes: explicitBucketSize ?? 60,
      providers: [],
      systemAvailability: 0,
    };
  }

  const providerIdList = providerList.map((provider) => provider.id);

  // Ensure minimum bucket size of 0.25 minutes (15 seconds) to prevent division by zero
  // Handle NaN case (nullish coalescing doesn't catch NaN from invalid parseFloat input)
  const rawBucketSize = explicitBucketSize ?? determineOptimalBucketSize(0, timeRangeMinutes);
  const bucketSizeMinutes = Number.isNaN(rawBucketSize)
    ? determineOptimalBucketSize(0, timeRangeMinutes)
    : Math.max(0.25, rawBucketSize);
  const bucketSizeMs = bucketSizeMinutes * 60 * 1000;
  const bucketSizeSeconds = bucketSizeMinutes * 60;
  const requestConditions = buildAvailabilityRequestConditions({
    providerIds: providerIdList,
    startDate,
    endDate,
  });
  const shouldLimitBuckets = Number.isFinite(maxBuckets) && maxBuckets > 0;

  const availabilityAggregationCtes = sql`
    finalized_requests AS (
      SELECT
        ${messageRequest.providerId} AS "providerId",
        ${messageRequest.createdAt} AS "createdAt",
        ${messageRequest.statusCode} AS "statusCode",
        ${messageRequest.durationMs} AS "durationMs",
        to_timestamp(
          floor(extract(epoch from ${messageRequest.createdAt}) / ${bucketSizeSeconds}) * ${bucketSizeSeconds}
        ) AS "bucketStart"
      FROM ${messageRequest}
      WHERE ${requestConditions}
    ),
    provider_bucket_stats AS (
      SELECT
        "providerId",
        "bucketStart",
        COUNT(*)::int AS "totalRequests",
        COUNT(*) FILTER (WHERE "statusCode" >= 200 AND "statusCode" < 400)::int AS "greenCount",
        COUNT(*) FILTER (WHERE "statusCode" < 200 OR "statusCode" >= 400)::int AS "redCount",
        COUNT("durationMs")::int AS "latencyCount",
        COALESCE(SUM("durationMs")::double precision, 0) AS "latencySumMs",
        COALESCE(AVG("durationMs")::double precision, 0) AS "avgLatencyMs",
        COALESCE(
          percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs"::double precision)
            FILTER (WHERE "durationMs" IS NOT NULL),
          0
        )::double precision AS "p50LatencyMs",
        COALESCE(
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"::double precision)
            FILTER (WHERE "durationMs" IS NOT NULL),
          0
        )::double precision AS "p95LatencyMs",
        COALESCE(
          percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs"::double precision)
            FILTER (WHERE "durationMs" IS NOT NULL),
          0
        )::double precision AS "p99LatencyMs",
        MAX("createdAt") AS "lastRequestAt"
      FROM finalized_requests
      GROUP BY "providerId", "bucketStart"
    )
  `;

  const bucketQuery = shouldLimitBuckets
    ? sql<AggregatedAvailabilityBucketRow>`
        WITH
          ${availabilityAggregationCtes},
          limited_provider_bucket_stats AS (
            SELECT
              *,
              ROW_NUMBER() OVER (PARTITION BY "providerId" ORDER BY "bucketStart" DESC) AS rn
            FROM provider_bucket_stats
          )
        SELECT
          "providerId",
          "bucketStart",
          "totalRequests",
          "greenCount",
          "redCount",
          "latencyCount",
          "latencySumMs",
          "avgLatencyMs",
          "p50LatencyMs",
          "p95LatencyMs",
          "p99LatencyMs",
          "lastRequestAt"
        FROM limited_provider_bucket_stats
        WHERE rn <= ${Math.floor(maxBuckets)}
        ORDER BY "providerId" ASC, "bucketStart" ASC
      `
    : sql<AggregatedAvailabilityBucketRow>`
        WITH ${availabilityAggregationCtes}
        SELECT
          "providerId",
          "bucketStart",
          "totalRequests",
          "greenCount",
          "redCount",
          "latencyCount",
          "latencySumMs",
          "avgLatencyMs",
          "p50LatencyMs",
          "p95LatencyMs",
          "p99LatencyMs",
          "lastRequestAt"
        FROM provider_bucket_stats
        ORDER BY "providerId" ASC, "bucketStart" ASC
      `;

  const bucketRows = Array.from(await db.execute(bucketQuery)) as AggregatedAvailabilityBucketRow[];
  const providerBuckets = new Map<number, AggregatedAvailabilityBucketRow[]>();

  for (const provider of providerList) {
    providerBuckets.set(provider.id, []);
  }

  for (const row of bucketRows) {
    providerBuckets.get(row.providerId)?.push(row);
  }

  // Build provider summaries
  const providerSummaries: ProviderAvailabilitySummary[] = [];

  for (const provider of providerList) {
    const bucketRowsForProvider = providerBuckets.get(provider.id) ?? [];
    const timeBuckets: TimeBucketMetrics[] = [];

    let totalGreen = 0;
    let totalRed = 0;
    let totalLatencyCount = 0;
    let totalLatencySumMs = 0;
    let lastRequestAtTime = 0;

    for (const bucket of bucketRowsForProvider) {
      totalGreen += toFiniteNumber(bucket.greenCount);
      totalRed += toFiniteNumber(bucket.redCount);
      totalLatencyCount += toFiniteNumber(bucket.latencyCount);
      totalLatencySumMs += toFiniteNumber(bucket.latencySumMs);
      lastRequestAtTime = Math.max(lastRequestAtTime, getTimeValue(bucket.lastRequestAt));

      const bucketStart = new Date(bucket.bucketStart);
      const bucketEnd = new Date(bucketStart.getTime() + bucketSizeMs);

      timeBuckets.push({
        bucketStart: bucketStart.toISOString(),
        bucketEnd: bucketEnd.toISOString(),
        totalRequests: toFiniteNumber(bucket.totalRequests),
        greenCount: toFiniteNumber(bucket.greenCount),
        redCount: toFiniteNumber(bucket.redCount),
        availabilityScore: calculateAvailabilityScore(
          toFiniteNumber(bucket.greenCount),
          toFiniteNumber(bucket.redCount)
        ),
        avgLatencyMs: toFiniteNumber(bucket.avgLatencyMs),
        p50LatencyMs: toFiniteNumber(bucket.p50LatencyMs),
        p95LatencyMs: toFiniteNumber(bucket.p95LatencyMs),
        p99LatencyMs: toFiniteNumber(bucket.p99LatencyMs),
      });
    }

    const totalRequests = totalGreen + totalRed;

    // Determine current status based on last few buckets
    // IMPORTANT: No data = 'unknown', NOT 'green'! Must be honest.
    let currentStatus: AvailabilityStatus = "unknown";
    if (timeBuckets.length > 0) {
      const recentBuckets = timeBuckets.slice(-3); // Last 3 buckets
      const recentScore =
        recentBuckets.reduce((sum, bucket) => sum + bucket.availabilityScore, 0) /
        recentBuckets.length;

      // Simple: >= 50% success = green, otherwise red
      currentStatus = recentScore >= 0.5 ? "green" : "red";
    }

    providerSummaries.push({
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.providerType ?? "claude",
      isEnabled: provider.enabled ?? true,
      currentStatus,
      currentAvailability: calculateAvailabilityScore(totalGreen, totalRed),
      totalRequests,
      successRate: totalRequests > 0 ? totalGreen / totalRequests : 0,
      avgLatencyMs: totalLatencyCount > 0 ? totalLatencySumMs / totalLatencyCount : 0,
      lastRequestAt: lastRequestAtTime > 0 ? new Date(lastRequestAtTime).toISOString() : null,
      timeBuckets,
    });
  }

  // Calculate system-wide availability
  const totalSystemRequests = providerSummaries.reduce(
    (sum, provider) => sum + provider.totalRequests,
    0
  );
  const weightedSystemAvailability =
    totalSystemRequests > 0
      ? providerSummaries.reduce(
          (sum, provider) => sum + provider.currentAvailability * provider.totalRequests,
          0
        ) / totalSystemRequests
      : 0;

  return {
    queriedAt: now.toISOString(),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    bucketSizeMinutes,
    providers: providerSummaries,
    systemAvailability: weightedSystemAvailability,
  };
}

/**
 * Get current availability status for all providers (lightweight query)
 */
export async function getCurrentProviderStatus(): Promise<
  Array<{
    providerId: number;
    providerName: string;
    status: AvailabilityStatus;
    availability: number;
    requestCount: number;
    lastRequestAt: string | null;
  }>
> {
  // Query last 15 minutes of data for current status
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Get enabled providers
  const providerList = await db
    .select({
      id: providers.id,
      name: providers.name,
    })
    .from(providers)
    .where(and(eq(providers.isEnabled, true), isNull(providers.deletedAt)));

  if (providerList.length === 0) {
    return [];
  }

  const providerIdList = providerList.map((provider) => provider.id);
  const requestConditions = buildAvailabilityRequestConditions({
    providerIds: providerIdList,
    startDate: fifteenMinutesAgo,
  });

  const aggregateQuery = sql<AggregatedCurrentProviderStatusRow>`
    SELECT
      ${messageRequest.providerId} AS "providerId",
      COUNT(*) FILTER (WHERE ${messageRequest.statusCode} >= 200 AND ${messageRequest.statusCode} < 400)::int AS "greenCount",
      COUNT(*) FILTER (WHERE ${messageRequest.statusCode} < 200 OR ${messageRequest.statusCode} >= 400)::int AS "redCount",
      MAX(${messageRequest.createdAt}) AS "lastRequestAt"
    FROM ${messageRequest}
    WHERE ${requestConditions}
    GROUP BY ${messageRequest.providerId}
  `;

  const aggregateRows = Array.from(
    await db.execute(aggregateQuery)
  ) as AggregatedCurrentProviderStatusRow[];
  const providerStats = new Map<
    number,
    {
      greenCount: number;
      redCount: number;
      lastRequestAt: string | null;
    }
  >();

  for (const provider of providerList) {
    providerStats.set(provider.id, {
      greenCount: 0,
      redCount: 0,
      lastRequestAt: null,
    });
  }

  for (const row of aggregateRows) {
    providerStats.set(row.providerId, {
      greenCount: toFiniteNumber(row.greenCount),
      redCount: toFiniteNumber(row.redCount),
      lastRequestAt: toIsoString(row.lastRequestAt),
    });
  }

  return providerList.map((provider) => {
    const stats = providerStats.get(provider.id)!;
    const total = stats.greenCount + stats.redCount;
    const availability = calculateAvailabilityScore(stats.greenCount, stats.redCount);

    // IMPORTANT: No data = 'unknown', NOT 'green'! Must be honest.
    let status: AvailabilityStatus = "unknown";
    if (total === 0) {
      status = "unknown"; // No data - must be honest, don't assume healthy!
    } else {
      // Simple: >= 50% success = green, otherwise red
      status = availability >= 0.5 ? "green" : "red";
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      status,
      availability,
      requestCount: total,
      lastRequestAt: stats.lastRequestAt,
    };
  });
}
