/**
 * Provider Availability Aggregation Service
 * Calculates availability metrics from request logs
 * Simple two-tier status: success (green) or failure (red)
 */

import { and, eq, inArray, isNotNull, isNull, type SQLWrapper, sql } from "drizzle-orm";
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

export const MIN_BUCKET_SIZE_MINUTES = 0.25;
export const MAX_BUCKET_SIZE_MINUTES = 1440;
const DEFAULT_MAX_BUCKETS = 100;
const AVAILABILITY_SUCCESS_STATUS_CODE_MIN = 200;
const AVAILABILITY_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE = 400;
const FINALIZED_REQUEST_STATUS_CODE_ALIAS = "statusCode" as const;
const AVAILABILITY_SUCCESS_STATUS_CODE_MIN_SQL = sql.raw(
  String(AVAILABILITY_SUCCESS_STATUS_CODE_MIN)
);
const AVAILABILITY_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE_SQL = sql.raw(
  String(AVAILABILITY_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE)
);
const FINALIZED_REQUEST_STATUS_CODE_SQL = sql.raw(`"${FINALIZED_REQUEST_STATUS_CODE_ALIAS}"`);
// Keep the hard cap independent from the UI/API default so future default tuning does not silently relax/tighten the guardrail.
// It intentionally equals the default today; the separation preserves distinct semantic roles for future tuning.
export const MAX_BUCKETS_HARD_LIMIT = 100;
export const MAX_AVAILABILITY_QUERY_RANGE_DAYS =
  (MAX_BUCKETS_HARD_LIMIT * MAX_BUCKET_SIZE_MINUTES) / (24 * 60);
const MAX_AVAILABILITY_QUERY_RANGE_MS =
  MAX_BUCKETS_HARD_LIMIT * MAX_BUCKET_SIZE_MINUTES * 60 * 1000;

export class AvailabilityQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityQueryValidationError";
  }
}

/**
 * 当前版本把“已终态”收敛为 `statusCode` 已落库。
 *
 * 已知限制：在当前异步写入/丢 patch 的极端场景，或未来新增了 `durationMs` / `errorMessage`
 * 已落库、但 `statusCode` 仍为空且已稳定结束的写路径时，这些记录会被当前可用性统计排除。
 * 届时应引入独立的 finalized 谓词，而不是直接放宽为 `durationMs IS NOT NULL`。
 */
function buildAvailabilityFinalizedCondition() {
  return isNotNull(messageRequest.statusCode);
}

function assertValidDate(date: Date, fieldName: string): Date {
  if (!Number.isFinite(date.getTime())) {
    throw new AvailabilityQueryValidationError(
      `Invalid ${fieldName}: expected a valid Date or ISO timestamp`
    );
  }

  return date;
}

function parseAvailabilityDate(value: Date | string, fieldName: string): Date {
  return assertValidDate(typeof value === "string" ? new Date(value) : value, fieldName);
}

function buildTimestampLowerBound(
  column: typeof messageRequest.createdAt,
  date: Date,
  fieldName: string
) {
  return sql`${column} >= CAST(${assertValidDate(date, fieldName).toISOString()} AS timestamptz)`;
}

function buildTimestampUpperBound(
  column: typeof messageRequest.createdAt,
  date: Date,
  fieldName: string
) {
  return sql`${column} <= CAST(${assertValidDate(date, fieldName).toISOString()} AS timestamptz)`;
}

function buildAvailabilityRequestConditions(input: {
  providerIds: number[];
  startDate: Date;
  endDate?: Date;
}) {
  const conditions = [
    inArray(messageRequest.providerId, input.providerIds),
    buildTimestampLowerBound(messageRequest.createdAt, input.startDate, "startTime"),
    isNull(messageRequest.deletedAt),
    buildAvailabilityFinalizedCondition(),
  ];

  if (input.endDate) {
    conditions.push(buildTimestampUpperBound(messageRequest.createdAt, input.endDate, "endTime"));
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

function isAvailabilitySuccessStatusCode(statusCode: number): boolean {
  return (
    statusCode >= AVAILABILITY_SUCCESS_STATUS_CODE_MIN &&
    statusCode < AVAILABILITY_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE
  );
}

function buildAvailabilitySuccessStatusCondition(statusCodeExpression: SQLWrapper) {
  return sql`${statusCodeExpression} >= ${AVAILABILITY_SUCCESS_STATUS_CODE_MIN_SQL}
    AND ${statusCodeExpression} < ${AVAILABILITY_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE_SQL}`;
}

function buildAvailabilityFailureStatusCondition(statusCodeExpression: SQLWrapper) {
  return sql`(${statusCodeExpression} < ${AVAILABILITY_SUCCESS_STATUS_CODE_MIN_SQL}
    OR ${statusCodeExpression} >= ${AVAILABILITY_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE_SQL})`;
}

/**
 * Classify a single finalized request's status
 * Simple: success (2xx/3xx) = green, failure = red
 */
export function classifyRequestStatus(statusCode: number): RequestStatusClassification {
  // 仅把 2xx/3xx 视为成功；1xx 不应在可用性里被计为绿色。
  if (isAvailabilitySuccessStatusCode(statusCode)) {
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

function sanitizeBucketSizeMinutes(
  explicitBucketSize: number | undefined,
  timeRangeMinutes: number
): number {
  const fallbackBucketSize = determineOptimalBucketSize(0, timeRangeMinutes);
  const safeFallbackBucketSize =
    Number.isFinite(fallbackBucketSize) && fallbackBucketSize > 0 ? fallbackBucketSize : 60;

  if (
    typeof explicitBucketSize !== "number" ||
    !Number.isFinite(explicitBucketSize) ||
    explicitBucketSize <= 0
  ) {
    return Math.min(
      MAX_BUCKET_SIZE_MINUTES,
      Math.max(MIN_BUCKET_SIZE_MINUTES, safeFallbackBucketSize)
    );
  }

  return Math.min(MAX_BUCKET_SIZE_MINUTES, Math.max(MIN_BUCKET_SIZE_MINUTES, explicitBucketSize));
}

function sanitizeMaxBuckets(maxBuckets: number | undefined): number {
  if (typeof maxBuckets !== "number" || !Number.isFinite(maxBuckets) || maxBuckets <= 0) {
    return DEFAULT_MAX_BUCKETS;
  }

  return Math.min(MAX_BUCKETS_HARD_LIMIT, Math.max(1, Math.floor(maxBuckets)));
}

function validateAvailabilityTimeRange(startDate: Date, endDate: Date): void {
  const rangeMs = endDate.getTime() - startDate.getTime();

  if (rangeMs < 0) {
    throw new AvailabilityQueryValidationError(
      "Invalid time range: endTime must be greater than or equal to startTime"
    );
  }

  if (rangeMs > MAX_AVAILABILITY_QUERY_RANGE_MS) {
    throw new AvailabilityQueryValidationError(
      `Invalid time range: requested range must not exceed ${MAX_AVAILABILITY_QUERY_RANGE_DAYS} days`
    );
  }
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
    maxBuckets = DEFAULT_MAX_BUCKETS,
  } = options;

  // Apply defaults first so both implicit defaults and user-supplied values share the same parse/validation path.
  const startDate = parseAvailabilityDate(startTime, "startTime");
  const endDate = parseAvailabilityDate(endTime, "endTime");
  validateAvailabilityTimeRange(startDate, endDate);
  const timeRangeMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
  const bucketSizeMinutes = sanitizeBucketSizeMinutes(explicitBucketSize, timeRangeMinutes);
  const bucketSizeMs = bucketSizeMinutes * 60 * 1000;
  const bucketSizeSeconds = bucketSizeMinutes * 60;
  const sanitizedMaxBuckets = sanitizeMaxBuckets(maxBuckets);

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
      bucketSizeMinutes,
      providers: [],
      systemAvailability: 0,
    };
  }

  const providerIdList = providerList.map((provider) => provider.id);
  const requestConditions = buildAvailabilityRequestConditions({
    providerIds: providerIdList,
    startDate,
    endDate,
  });

  const availabilityAggregationCtes = sql`
    finalized_requests AS (
      SELECT
        ${messageRequest.providerId} AS "providerId",
        ${messageRequest.createdAt} AS "createdAt",
        ${messageRequest.statusCode} AS ${FINALIZED_REQUEST_STATUS_CODE_SQL},
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
        COUNT(*) FILTER (WHERE ${buildAvailabilitySuccessStatusCondition(FINALIZED_REQUEST_STATUS_CODE_SQL)})::int AS "greenCount",
        COUNT(*) FILTER (WHERE ${buildAvailabilityFailureStatusCondition(FINALIZED_REQUEST_STATUS_CODE_SQL)})::int AS "redCount",
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

  const bucketQuery = sql<AggregatedAvailabilityBucketRow>`
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
    WHERE rn <= ${sanitizedMaxBuckets}
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
      const greenCount = toFiniteNumber(bucket.greenCount);
      const redCount = toFiniteNumber(bucket.redCount);
      const totalRequests = greenCount + redCount;
      const latencyCount = toFiniteNumber(bucket.latencyCount);
      const latencySumMs = toFiniteNumber(bucket.latencySumMs);

      totalGreen += greenCount;
      totalRed += redCount;
      totalLatencyCount += latencyCount;
      totalLatencySumMs += latencySumMs;
      lastRequestAtTime = Math.max(lastRequestAtTime, getTimeValue(bucket.lastRequestAt));

      const bucketStart = new Date(bucket.bucketStart);
      const bucketEnd = new Date(bucketStart.getTime() + bucketSizeMs);

      timeBuckets.push({
        bucketStart: bucketStart.toISOString(),
        bucketEnd: bucketEnd.toISOString(),
        totalRequests,
        greenCount,
        redCount,
        availabilityScore: calculateAvailabilityScore(greenCount, redCount),
        avgLatencyMs: toFiniteNumber(bucket.avgLatencyMs),
        p50LatencyMs: toFiniteNumber(bucket.p50LatencyMs),
        p95LatencyMs: toFiniteNumber(bucket.p95LatencyMs),
        p99LatencyMs: toFiniteNumber(bucket.p99LatencyMs),
      });
    }

    const totalRequests = totalGreen + totalRed;
    const returnedBucketAvailability = calculateAvailabilityScore(totalGreen, totalRed);

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
      currentAvailability: returnedBucketAvailability,
      totalRequests,
      // Keep `successRate` as a compatibility alias of the returned-bucket availability ratio.
      successRate: returnedBucketAvailability,
      avgLatencyMs: totalLatencyCount > 0 ? totalLatencySumMs / totalLatencyCount : 0,
      lastRequestAt: lastRequestAtTime > 0 ? new Date(lastRequestAtTime).toISOString() : null,
      timeBuckets,
    });
  }

  // Calculate system-wide availability from the buckets returned after per-provider trimming.
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
    endDate: now,
  });

  const aggregateQuery = sql<AggregatedCurrentProviderStatusRow>`
    SELECT
      ${messageRequest.providerId} AS "providerId",
      COUNT(*) FILTER (WHERE ${buildAvailabilitySuccessStatusCondition(messageRequest.statusCode)})::int AS "greenCount",
      COUNT(*) FILTER (WHERE ${buildAvailabilityFailureStatusCondition(messageRequest.statusCode)})::int AS "redCount",
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
