import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpointProbeEvents, providerEndpoints, providerVendors } from "@/drizzle/schema";
import { calculateAvailabilityScore, determineOptimalBucketSize } from "@/lib/availability";
import { logger } from "@/lib/logger";
import type { ProviderType } from "@/types/provider";
import type {
  EndpointAvailabilityQueryOptions,
  EndpointAvailabilityQueryResult,
  EndpointAvailabilitySummary,
  EndpointTimeBucketMetrics,
} from "./types";

const MAX_EVENTS_PER_QUERY = 100000;

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

export async function queryEndpointAvailability(
  options: EndpointAvailabilityQueryOptions = {}
): Promise<EndpointAvailabilityQueryResult> {
  const now = new Date();
  const {
    startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000),
    endTime = now,
    endpointIds = [],
    vendorIds = [],
    providerTypes = [],
    bucketSizeMinutes: explicitBucketSize,
    includeDisabled = false,
    maxBuckets = 100,
  } = options;

  const startDate = typeof startTime === "string" ? new Date(startTime) : startTime;
  const endDate = typeof endTime === "string" ? new Date(endTime) : endTime;
  const timeRangeMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);

  const endpointConditions = [isNull(providerEndpoints.deletedAt)];
  if (!includeDisabled) {
    endpointConditions.push(eq(providerEndpoints.isEnabled, true));
  }
  if (endpointIds.length > 0) {
    endpointConditions.push(inArray(providerEndpoints.id, endpointIds));
  }
  if (vendorIds.length > 0) {
    endpointConditions.push(inArray(providerEndpoints.vendorId, vendorIds));
  }
  if (providerTypes.length > 0) {
    endpointConditions.push(inArray(providerEndpoints.providerType, providerTypes));
  }

  const endpointList = await db
    .select({
      id: providerEndpoints.id,
      vendorId: providerEndpoints.vendorId,
      providerType: providerEndpoints.providerType,
      baseUrl: providerEndpoints.baseUrl,
      isEnabled: providerEndpoints.isEnabled,
      vendorName: providerVendors.displayName,
    })
    .from(providerEndpoints)
    .leftJoin(
      providerVendors,
      and(eq(providerEndpoints.vendorId, providerVendors.id), isNull(providerVendors.deletedAt))
    )
    .where(and(...endpointConditions))
    .orderBy(
      asc(providerEndpoints.vendorId),
      asc(providerEndpoints.providerType),
      asc(providerEndpoints.priority),
      asc(providerEndpoints.id)
    );

  if (endpointList.length === 0) {
    return {
      queriedAt: now.toISOString(),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      bucketSizeMinutes: explicitBucketSize ?? 60,
      endpoints: [],
      systemAvailability: 0,
    };
  }

  const endpointIdList = endpointList.map((e) => e.id);

  const events = await db
    .select({
      endpointId: providerEndpointProbeEvents.endpointId,
      result: providerEndpointProbeEvents.result,
      latencyMs: providerEndpointProbeEvents.latencyMs,
      checkedAt: providerEndpointProbeEvents.checkedAt,
    })
    .from(providerEndpointProbeEvents)
    .where(
      and(
        inArray(providerEndpointProbeEvents.endpointId, endpointIdList),
        gte(providerEndpointProbeEvents.checkedAt, startDate),
        lte(providerEndpointProbeEvents.checkedAt, endDate)
      )
    )
    .orderBy(asc(providerEndpointProbeEvents.checkedAt))
    .limit(MAX_EVENTS_PER_QUERY);

  if (events.length === MAX_EVENTS_PER_QUERY) {
    logger.warn("[EndpointAvailability] Query hit max events limit, results may be incomplete", {
      limit: MAX_EVENTS_PER_QUERY,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
    });
  }

  const rawBucketSize =
    explicitBucketSize ?? determineOptimalBucketSize(events.length, timeRangeMinutes);
  const bucketSizeMinutes = Number.isNaN(rawBucketSize)
    ? determineOptimalBucketSize(events.length, timeRangeMinutes)
    : Math.max(0.25, rawBucketSize);
  const bucketSizeMs = bucketSizeMinutes * 60 * 1000;

  const endpointBuckets = new Map<
    number,
    Map<
      string,
      {
        greenCount: number;
        redCount: number;
        latencies: number[];
      }
    >
  >();

  for (const endpoint of endpointList) {
    endpointBuckets.set(endpoint.id, new Map());
  }

  for (const evt of events) {
    if (!evt.checkedAt) continue;

    const bucketStart = new Date(Math.floor(evt.checkedAt.getTime() / bucketSizeMs) * bucketSizeMs);
    const bucketKey = bucketStart.toISOString();

    const endpointData = endpointBuckets.get(evt.endpointId);
    if (!endpointData) continue;

    if (!endpointData.has(bucketKey)) {
      endpointData.set(bucketKey, {
        greenCount: 0,
        redCount: 0,
        latencies: [],
      });
    }

    const bucket = endpointData.get(bucketKey);
    if (!bucket) continue;

    if (evt.result === "success") {
      bucket.greenCount++;
    } else {
      bucket.redCount++;
    }

    if (evt.latencyMs !== null) {
      bucket.latencies.push(evt.latencyMs);
    }
  }

  const endpointSummaries: EndpointAvailabilitySummary[] = [];

  for (const endpoint of endpointList) {
    const bucketData = endpointBuckets.get(endpoint.id);
    const timeBuckets: EndpointTimeBucketMetrics[] = [];

    let totalGreen = 0;
    let totalRed = 0;
    const allLatencies: number[] = [];
    let lastProbeAt: string | null = null;

    const sortedBucketKeys = Array.from(bucketData?.keys() ?? [])
      .sort()
      .slice(-maxBuckets);

    for (const bucketKey of sortedBucketKeys) {
      const bucket = bucketData?.get(bucketKey);
      if (!bucket) continue;

      const bucketStart = new Date(bucketKey);
      const bucketEnd = new Date(bucketStart.getTime() + bucketSizeMs);

      totalGreen += bucket.greenCount;
      totalRed += bucket.redCount;

      allLatencies.push(...bucket.latencies);

      const sortedLatencies = [...bucket.latencies].sort((a, b) => a - b);
      const total = bucket.greenCount + bucket.redCount;

      timeBuckets.push({
        bucketStart: bucketStart.toISOString(),
        bucketEnd: bucketEnd.toISOString(),
        totalProbes: total,
        greenCount: bucket.greenCount,
        redCount: bucket.redCount,
        availabilityScore: calculateAvailabilityScore(bucket.greenCount, bucket.redCount),
        avgLatencyMs:
          sortedLatencies.length > 0
            ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
            : 0,
        p50LatencyMs: calculatePercentile(sortedLatencies, 50),
        p95LatencyMs: calculatePercentile(sortedLatencies, 95),
        p99LatencyMs: calculatePercentile(sortedLatencies, 99),
      });

      if (total > 0) {
        lastProbeAt = bucketEnd.toISOString();
      }
    }

    const totalProbes = totalGreen + totalRed;
    const sortedAllLatencies = allLatencies.sort((a, b) => a - b);

    let currentStatus: EndpointAvailabilitySummary["currentStatus"] = "unknown";
    if (timeBuckets.length > 0) {
      const recentBuckets = timeBuckets.slice(-3);
      const recentScore =
        recentBuckets.reduce((sum, b) => sum + b.availabilityScore, 0) / recentBuckets.length;

      currentStatus = recentScore >= 0.5 ? "green" : "red";
    }

    endpointSummaries.push({
      endpointId: endpoint.id,
      vendorId: endpoint.vendorId,
      vendorName: endpoint.vendorName ?? "",
      providerType: (endpoint.providerType || "claude") as ProviderType,
      baseUrl: endpoint.baseUrl,
      isEnabled: endpoint.isEnabled ?? true,
      currentStatus,
      currentAvailability: calculateAvailabilityScore(totalGreen, totalRed),
      totalProbes,
      successRate: totalProbes > 0 ? totalGreen / totalProbes : 0,
      avgLatencyMs:
        sortedAllLatencies.length > 0
          ? sortedAllLatencies.reduce((a, b) => a + b, 0) / sortedAllLatencies.length
          : 0,
      lastProbeAt,
      timeBuckets,
    });
  }

  const totalSystemProbes = endpointSummaries.reduce((sum, e) => sum + e.totalProbes, 0);
  const weightedSystemAvailability =
    totalSystemProbes > 0
      ? endpointSummaries.reduce((sum, e) => sum + e.currentAvailability * e.totalProbes, 0) /
        totalSystemProbes
      : 0;

  return {
    queriedAt: now.toISOString(),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    bucketSizeMinutes,
    endpoints: endpointSummaries,
    systemAvailability: weightedSystemAvailability,
  };
}

export async function getCurrentEndpointStatus(): Promise<
  Array<{
    endpointId: number;
    vendorId: number;
    vendorName: string;
    providerType: ProviderType;
    baseUrl: string;
    status: EndpointAvailabilitySummary["currentStatus"];
    availability: number;
    probeCount: number;
    lastProbeAt: string | null;
  }>
> {
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const endpointList = await db
    .select({
      id: providerEndpoints.id,
      vendorId: providerEndpoints.vendorId,
      providerType: providerEndpoints.providerType,
      baseUrl: providerEndpoints.baseUrl,
      vendorName: providerVendors.displayName,
    })
    .from(providerEndpoints)
    .leftJoin(
      providerVendors,
      and(eq(providerEndpoints.vendorId, providerVendors.id), isNull(providerVendors.deletedAt))
    )
    .where(and(eq(providerEndpoints.isEnabled, true), isNull(providerEndpoints.deletedAt)));

  if (endpointList.length === 0) {
    return [];
  }

  const endpointIdList = endpointList.map((e) => e.id);

  const events = await db
    .select({
      endpointId: providerEndpointProbeEvents.endpointId,
      result: providerEndpointProbeEvents.result,
      checkedAt: providerEndpointProbeEvents.checkedAt,
    })
    .from(providerEndpointProbeEvents)
    .where(
      and(
        inArray(providerEndpointProbeEvents.endpointId, endpointIdList),
        gte(providerEndpointProbeEvents.checkedAt, fifteenMinutesAgo),
        lte(providerEndpointProbeEvents.checkedAt, now)
      )
    )
    .orderBy(desc(providerEndpointProbeEvents.checkedAt));

  const endpointStats = new Map<
    number,
    {
      greenCount: number;
      redCount: number;
      lastProbeAt: string | null;
    }
  >();

  for (const endpoint of endpointList) {
    endpointStats.set(endpoint.id, { greenCount: 0, redCount: 0, lastProbeAt: null });
  }

  for (const evt of events) {
    const stats = endpointStats.get(evt.endpointId);
    if (!stats) continue;

    if (!stats.lastProbeAt && evt.checkedAt) {
      stats.lastProbeAt = evt.checkedAt.toISOString();
    }

    if (evt.result === "success") {
      stats.greenCount++;
    } else {
      stats.redCount++;
    }
  }

  return endpointList.map((endpoint) => {
    const stats = endpointStats.get(endpoint.id);
    const green = stats?.greenCount ?? 0;
    const red = stats?.redCount ?? 0;
    const total = green + red;

    const availability = calculateAvailabilityScore(green, red);

    return {
      endpointId: endpoint.id,
      vendorId: endpoint.vendorId,
      vendorName: endpoint.vendorName ?? "",
      providerType: (endpoint.providerType || "claude") as ProviderType,
      baseUrl: endpoint.baseUrl,
      status: total === 0 ? "unknown" : availability >= 0.5 ? "green" : "red",
      availability,
      probeCount: total,
      lastProbeAt: stats?.lastProbeAt ?? null,
    };
  });
}
