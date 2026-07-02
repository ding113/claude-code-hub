import { logger } from "@/lib/logger";
import type { PublicStatusConfiguredGroup } from "@/lib/public-status/aggregation-core";
import { computeTokensPerSecond } from "@/lib/public-status/aggregation-core";
import {
  type InternalPublicStatusConfigSnapshot,
  readCurrentInternalPublicStatusConfigSnapshot,
} from "@/lib/public-status/config-snapshot";
import { PUBLIC_STATUS_INTERVAL_OPTIONS } from "@/lib/public-status/constants";
import type { PublicStatusPayload, PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import {
  alignBucketStartUtc,
  buildPublicStatusRollupCoverageStartKey,
  buildPublicStatusRollupKey,
  PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES,
} from "@/lib/public-status/redis-contract";
import { getRedisClient } from "@/lib/redis";
import {
  classifyProviderChainItemOutcome,
  resolveSuccessRateModelKey,
} from "@/lib/request-outcome";
import { resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import type { ProviderChainItem } from "@/types/message";

const ROLLUP_FIELD_SEPARATOR = "|";
const ROLLUP_TTL_SECONDS = 60 * 60 * 24 * 32;
const CONFIGURED_GROUPS_CACHE_TTL_MS = 30_000;
const EMPTY_CONFIGURED_GROUPS_CACHE_TTL_MS = 5_000;

export type PublicStatusRollupMetric =
  | "success"
  | "failure"
  | "ttfb_sum"
  | "ttfb_count"
  | "tps_sum"
  | "tps_count";

export interface PublicStatusRollupEvent {
  createdAt: string | Date;
  model?: string | null;
  originalModel?: string | null;
  durationMs?: number | null;
  ttfbMs?: number | null;
  outputTokens?: number | null;
  providerChain?: ProviderChainItem[] | null;
}

export interface PublicStatusRollupIncrement {
  groupId: string;
  modelKey: string;
  metric: PublicStatusRollupMetric;
  value: number;
}

export interface PublicStatusRollupBucket {
  bucketStart: string;
  values: Map<string, number>;
}

export interface PublicStatusRollupAggregationResult {
  generatedAt: string;
  coveredFrom: string;
  coveredTo: string;
  groups: PublicStatusPayload["groups"];
}

export type PublicStatusRollupWriteResult =
  | {
      written: true;
      retryable: false;
      incrementCount: number;
      key: string;
    }
  | {
      written: false;
      retryable: boolean;
      reason: "ignored" | "redis-unavailable" | "write-failed";
      incrementCount: number;
      key: string | null;
    };

interface RedisRollupWriter {
  hincrbyfloat?(key: string, field: string, increment: number): Promise<unknown> | unknown;
  expire?(key: string, seconds: number): Promise<unknown> | unknown;
  pipeline?(): {
    hincrbyfloat(key: string, field: string, increment: number): unknown;
    set?(key: string, value: string, mode: "NX"): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null> | Array<[Error | null, unknown]> | null;
  };
  set?(key: string, value: string, mode?: "NX"): Promise<unknown> | unknown;
  status?: string;
}

interface RedisRollupReader {
  hgetall(key: string): Promise<Record<string, string>> | Record<string, string>;
  pipeline?(): {
    hgetall(key: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
  status?: string;
}

let cachedConfiguredGroups: {
  configVersion: string;
  groups: PublicStatusConfiguredGroup[];
  retryable: boolean;
  expiresAt: number;
} | null = null;

function encodeRollupPart(value: string | number): string {
  return encodeURIComponent(String(value));
}

function decodeRollupPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function assertSupportedPublicStatusRollupInterval(intervalMinutes: number): void {
  if (
    !PUBLIC_STATUS_INTERVAL_OPTIONS.includes(
      intervalMinutes as (typeof PUBLIC_STATUS_INTERVAL_OPTIONS)[number]
    )
  ) {
    throw new Error(
      `Unsupported public status rollup intervalMinutes: ${intervalMinutes}. Supported values: ${PUBLIC_STATUS_INTERVAL_OPTIONS.join(
        ", "
      )}`
    );
  }
}

export function buildPublicStatusRollupField(input: {
  groupId: string | number;
  modelKey: string;
  metric: PublicStatusRollupMetric;
}): string {
  return [
    encodeRollupPart(input.groupId),
    encodeRollupPart(input.modelKey),
    encodeRollupPart(input.metric),
  ].join(ROLLUP_FIELD_SEPARATOR);
}

export function parsePublicStatusRollupField(
  field: string
): { groupId: string; modelKey: string; metric: PublicStatusRollupMetric } | null {
  const parts = field.split(ROLLUP_FIELD_SEPARATOR);
  if (parts.length !== 3) {
    return null;
  }

  const metric = decodeRollupPart(parts[2] ?? "");
  if (
    metric !== "success" &&
    metric !== "failure" &&
    metric !== "ttfb_sum" &&
    metric !== "ttfb_count" &&
    metric !== "tps_sum" &&
    metric !== "tps_count"
  ) {
    return null;
  }

  return {
    groupId: decodeRollupPart(parts[0] ?? ""),
    modelKey: decodeRollupPart(parts[1] ?? ""),
    metric,
  };
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getPublicStatusGroupId(
  input: Pick<PublicStatusConfiguredGroup, "sourceGroupId" | "sourceGroupName">
): string {
  return input.sourceGroupId !== undefined && input.sourceGroupId !== null
    ? String(input.sourceGroupId)
    : input.sourceGroupName;
}

function getPublicStatusGroupRollupIds(
  input: Pick<PublicStatusConfiguredGroup, "sourceGroupId" | "sourceGroupName">
): string[] {
  const primary = getPublicStatusGroupId(input);
  return [primary];
}

function buildConfiguredGroupLookups(groups: PublicStatusConfiguredGroup[]): {
  modelToGroups: Map<string, PublicStatusConfiguredGroup[]>;
  groupsBySourceName: Map<string, PublicStatusConfiguredGroup>;
  groupsByRollupId: Map<string, PublicStatusConfiguredGroup>;
} {
  const modelToGroups = new Map<string, PublicStatusConfiguredGroup[]>();
  const groupsBySourceName = new Map<string, PublicStatusConfiguredGroup>();
  const groupsByRollupId = new Map<string, PublicStatusConfiguredGroup>();

  for (const group of groups) {
    groupsBySourceName.set(group.sourceGroupName, group);
    groupsByRollupId.set(getPublicStatusGroupId(group), group);
    for (const model of group.models) {
      const existing = modelToGroups.get(model.publicModelKey) ?? [];
      existing.push(group);
      modelToGroups.set(model.publicModelKey, existing);
    }
  }

  return { modelToGroups, groupsBySourceName, groupsByRollupId };
}

export function getConfiguredPublicStatusGroupsFromSnapshot(
  snapshot: InternalPublicStatusConfigSnapshot
): PublicStatusConfiguredGroup[] {
  return snapshot.groups
    .flatMap((group) =>
      typeof group.sourceGroupName === "string" &&
      group.sourceGroupName.trim().length > 0 &&
      Array.isArray(group.models) &&
      group.models.length > 0
        ? [
            {
              sourceGroupId: group.sourceGroupId ?? null,
              sourceGroupName: group.sourceGroupName.trim(),
              publicGroupSlug: group.slug,
              displayName: group.displayName,
              explanatoryCopy: group.description,
              sortOrder: group.sortOrder,
              models: group.models.map((model) => ({
                publicModelKey: model.publicModelKey,
                label: model.label,
                vendorIconKey: model.vendorIconKey,
                requestTypeBadge: model.requestTypeBadge,
              })),
            },
          ]
        : []
    )
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName)
    );
}

export async function getConfiguredPublicStatusGroupsForRollupResolution(): Promise<{
  groups: PublicStatusConfiguredGroup[];
  retryable: boolean;
}> {
  const now = Date.now();
  if (cachedConfiguredGroups && cachedConfiguredGroups.expiresAt > now) {
    return {
      groups: cachedConfiguredGroups.groups,
      retryable: cachedConfiguredGroups.retryable,
    };
  }

  const snapshot = await readCurrentInternalPublicStatusConfigSnapshot({
    allowLegacyFallback: false,
  });
  if (!snapshot) {
    cachedConfiguredGroups = {
      configVersion: "",
      groups: [],
      retryable: true,
      expiresAt: now + EMPTY_CONFIGURED_GROUPS_CACHE_TTL_MS,
    };
    return { groups: [], retryable: true };
  }

  const groups = getConfiguredPublicStatusGroupsFromSnapshot(snapshot);
  cachedConfiguredGroups = {
    configVersion: snapshot.configVersion,
    groups,
    retryable: false,
    expiresAt: now + CONFIGURED_GROUPS_CACHE_TTL_MS,
  };
  return { groups, retryable: false };
}

export async function getConfiguredPublicStatusGroupsForRollup(): Promise<
  PublicStatusConfiguredGroup[]
> {
  return (await getConfiguredPublicStatusGroupsForRollupResolution()).groups;
}

export function buildPublicStatusRollupIncrements(input: {
  event: PublicStatusRollupEvent;
  groups: PublicStatusConfiguredGroup[];
}): PublicStatusRollupIncrement[] {
  const modelKey = resolveSuccessRateModelKey({
    originalModel: input.event.originalModel,
    model: input.event.model,
  });
  if (!modelKey) {
    return [];
  }

  const { modelToGroups, groupsBySourceName, groupsByRollupId } = buildConfiguredGroupLookups(
    input.groups
  );
  const configuredGroups = modelToGroups.get(modelKey);
  if (!configuredGroups || configuredGroups.length === 0) {
    return [];
  }

  const groupOutcome = new Map<string, "success" | "failure" | "excluded">();
  for (const item of input.event.providerChain ?? []) {
    const outcome = classifyProviderChainItemOutcome({
      statusCode: item.statusCode ?? undefined,
      reason: item.reason ?? undefined,
      errorMessage: item.errorMessage ?? undefined,
      errorDetails: item.errorDetails,
    })?.outcome;
    if (!outcome) {
      continue;
    }

    const itemGroups = Array.from(new Set(resolveProviderGroupsWithDefault(item.groupTag)));
    for (const sourceGroupName of itemGroups) {
      if (!groupsBySourceName.has(sourceGroupName)) {
        continue;
      }

      const existing = groupOutcome.get(sourceGroupName);
      if (existing === "success") {
        continue;
      }

      if (outcome === "success") {
        groupOutcome.set(sourceGroupName, "success");
        continue;
      }

      if (!existing || existing === "excluded") {
        groupOutcome.set(sourceGroupName, outcome);
      }
    }
  }

  const ttfbMs = normalizeNumber(input.event.ttfbMs);
  const tps = computeTokensPerSecond({
    outputTokens: input.event.outputTokens,
    durationMs: input.event.durationMs,
    ttfbMs,
  });
  const increments: PublicStatusRollupIncrement[] = [];

  for (const [sourceGroupName, outcome] of groupOutcome.entries()) {
    if (outcome === "excluded") {
      continue;
    }

    const group = groupsBySourceName.get(sourceGroupName);
    if (!group?.models.some((model) => model.publicModelKey === modelKey)) {
      continue;
    }

    const groupId = getPublicStatusGroupId(group);
    if (groupsByRollupId.get(groupId) !== group) {
      continue;
    }
    increments.push({
      groupId,
      modelKey,
      metric: outcome === "success" ? "success" : "failure",
      value: 1,
    });
    if (outcome === "success" && ttfbMs !== null) {
      increments.push(
        { groupId, modelKey, metric: "ttfb_sum", value: ttfbMs },
        { groupId, modelKey, metric: "ttfb_count", value: 1 }
      );
    }
    if (outcome === "success" && tps !== null) {
      increments.push(
        { groupId, modelKey, metric: "tps_sum", value: tps },
        { groupId, modelKey, metric: "tps_count", value: 1 }
      );
    }
  }

  return increments;
}

export async function writePublicStatusRollupEvent(input: {
  event: PublicStatusRollupEvent;
  groups: PublicStatusConfiguredGroup[];
  redis?: RedisRollupWriter | null;
}): Promise<PublicStatusRollupWriteResult> {
  const increments = buildPublicStatusRollupIncrements(input);
  if (increments.length === 0) {
    return {
      written: false,
      retryable: false,
      reason: "ignored",
      incrementCount: 0,
      key: null,
    };
  }

  const createdAtIso =
    input.event.createdAt instanceof Date
      ? input.event.createdAt.toISOString()
      : input.event.createdAt;
  const key = buildPublicStatusRollupKey({ bucketStartIso: createdAtIso });
  const coverageStartKey = buildPublicStatusRollupCoverageStartKey();
  const bucketStartIso = alignBucketStartUtc(createdAtIso, PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES);
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (
    !redis ||
    ("status" in redis && redis.status && redis.status !== "ready") ||
    typeof redis.hincrbyfloat !== "function"
  ) {
    return {
      written: false,
      retryable: true,
      reason: "redis-unavailable",
      incrementCount: increments.length,
      key,
    };
  }

  if (typeof redis.pipeline === "function") {
    const pipeline = redis.pipeline();
    const pipelineOperationLabels: string[] = [];
    for (const increment of increments) {
      const field = buildPublicStatusRollupField(increment);
      pipeline.hincrbyfloat(key, field, increment.value);
      pipelineOperationLabels.push(field);
    }
    if (typeof pipeline.set === "function") {
      pipeline.set(coverageStartKey, bucketStartIso, "NX");
      pipelineOperationLabels.push(coverageStartKey);
      pipeline.expire(coverageStartKey, ROLLUP_TTL_SECONDS);
      pipelineOperationLabels.push(`${coverageStartKey}:expire`);
    }
    pipeline.expire(key, ROLLUP_TTL_SECONDS);
    pipelineOperationLabels.push(`${key}:expire`);
    const results = await pipeline.exec();
    if (!results) {
      throw new Error(`Public status rollup pipeline failed for ${key}: empty exec result`);
    }
    const failures = results?.flatMap(([error], index) => (error ? [{ error, index }] : [])) ?? [];
    if (failures.length > 0) {
      const firstFailure = failures[0]!;
      const failedField =
        pipelineOperationLabels[firstFailure.index] ?? `${key}:pipeline:${firstFailure.index}`;
      throw new Error(
        `Public status rollup pipeline failed for ${failedField}: ${firstFailure.error.message}`
      );
    }
  } else {
    if (typeof redis.hincrbyfloat !== "function") {
      throw new Error("Public status rollup Redis client does not support hincrbyfloat");
    }
    const hincrbyfloat = redis.hincrbyfloat.bind(redis);
    await Promise.all(
      increments.map((increment) =>
        hincrbyfloat(key, buildPublicStatusRollupField(increment), increment.value)
      )
    );
    if (typeof redis.set === "function") {
      await redis.set(coverageStartKey, bucketStartIso, "NX");
    }
    await redis.expire?.(key, ROLLUP_TTL_SECONDS);
    await redis.expire?.(coverageStartKey, ROLLUP_TTL_SECONDS);
  }

  return { written: true, retryable: false, incrementCount: increments.length, key };
}

export function queuePublicStatusRollupWrite(input: {
  event: PublicStatusRollupEvent;
  groups: PublicStatusConfiguredGroup[];
}): Promise<PublicStatusRollupWriteResult> {
  return writePublicStatusRollupEvent(input).catch((error) => {
    logger.warn("[PublicStatus] Failed to write rollup event", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      written: false,
      retryable: true,
      reason: "write-failed",
      incrementCount: 0,
      key: null,
    };
  });
}

export async function readPublicStatusRollupBuckets(input: {
  redis: RedisRollupReader;
  bucketStarts: string[];
}): Promise<PublicStatusRollupBucket[]> {
  const parseBucket = (bucketStart: string, raw: unknown): PublicStatusRollupBucket => {
    const values = new Map<string, number>();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { bucketStart, values };
    }

    for (const [field, rawValue] of Object.entries(raw as Record<string, string>)) {
      const value = Number(rawValue);
      if (Number.isFinite(value)) {
        values.set(field, value);
      }
    }
    return { bucketStart, values };
  };

  if (typeof input.redis.pipeline === "function") {
    const buckets: PublicStatusRollupBucket[] = [];
    const batchSize = 200;
    for (let index = 0; index < input.bucketStarts.length; index += batchSize) {
      const batchStarts = input.bucketStarts.slice(index, index + batchSize);
      const pipeline = input.redis.pipeline();
      for (const bucketStart of batchStarts) {
        pipeline.hgetall(buildPublicStatusRollupKey({ bucketStartIso: bucketStart }));
      }

      const results = await pipeline.exec();
      for (let batchIndex = 0; batchIndex < batchStarts.length; batchIndex++) {
        const [error, raw] = results?.[batchIndex] ?? [null, null];
        buckets.push(parseBucket(batchStarts[batchIndex]!, error ? null : raw));
      }
    }
    return buckets;
  }

  const buckets: PublicStatusRollupBucket[] = [];
  const concurrency = 32;
  for (let index = 0; index < input.bucketStarts.length; index += concurrency) {
    const batchStarts = input.bucketStarts.slice(index, index + concurrency);
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- rollup reads are intentionally batched to bound Redis concurrency
    const batchBuckets = await Promise.all(
      batchStarts.map(async (bucketStart) =>
        parseBucket(
          bucketStart,
          await input.redis.hgetall(buildPublicStatusRollupKey({ bucketStartIso: bucketStart }))
        )
      )
    );
    buckets.push(...batchBuckets);
  }

  return buckets;
}

function getRollupValue(input: {
  bucket: PublicStatusRollupBucket;
  groupId: string;
  modelKey: string;
  metric: PublicStatusRollupMetric;
}): number {
  return (
    input.bucket.values.get(
      buildPublicStatusRollupField({
        groupId: input.groupId,
        modelKey: input.modelKey,
        metric: input.metric,
      })
    ) ?? 0
  );
}

function applyBoundedGapFill(input: {
  timeline: Array<"operational" | "failed" | null>;
  maxGapBuckets?: number;
}): Array<"operational" | "failed" | null> {
  const result = [...input.timeline];
  const maxGapBuckets = input.maxGapBuckets ?? 3;

  let lastKnownIndex = -1;
  for (let index = 0; index < input.timeline.length; index++) {
    const current = input.timeline[index];
    if (current === null) {
      continue;
    }

    if (lastKnownIndex >= 0) {
      const previous = input.timeline[lastKnownIndex];
      const gapBuckets = index - lastKnownIndex - 1;
      if (
        gapBuckets > 0 &&
        gapBuckets <= maxGapBuckets &&
        previous !== null &&
        previous === current
      ) {
        for (let fillIndex = lastKnownIndex + 1; fillIndex < index; fillIndex++) {
          result[fillIndex] = previous;
        }
      }
    }

    lastKnownIndex = index;
  }

  return result;
}

function average(sum: number, count: number): number | null {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  return Number((sum / count).toFixed(4));
}

function buildBucketStarts(input: {
  now: string | Date;
  rangeHours: number;
  intervalMinutes: number;
}): { coveredFrom: string; coveredTo: string; bucketStarts: string[] } {
  assertSupportedPublicStatusRollupInterval(input.intervalMinutes);
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const baseBucketMs = PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES * 60 * 1000;
  const bucketCount = Math.ceil((input.rangeHours * 60) / PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES);
  const coveredTo = alignBucketStartUtc(now.toISOString(), input.intervalMinutes);
  const coveredToMs = Date.parse(coveredTo);
  const coveredFromMs = coveredToMs - bucketCount * baseBucketMs;

  return {
    coveredFrom: new Date(coveredFromMs).toISOString(),
    coveredTo,
    bucketStarts: Array.from({ length: bucketCount }, (_, index) =>
      new Date(coveredFromMs + index * baseBucketMs).toISOString()
    ),
  };
}

export function buildPublicStatusPayloadFromRollups(input: {
  rangeHours: number;
  intervalMinutes: number;
  now: string | Date;
  groups: PublicStatusConfiguredGroup[];
  rollupBuckets: PublicStatusRollupBucket[];
}): PublicStatusRollupAggregationResult {
  const { coveredFrom, coveredTo, bucketStarts } = buildBucketStarts(input);
  const bucketByStart = new Map(input.rollupBuckets.map((bucket) => [bucket.bucketStart, bucket]));
  const intervalFactor = Math.max(
    1,
    Math.round(input.intervalMinutes / PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES)
  );
  const displayBuckets = bucketStarts.flatMap((bucketStart, index) =>
    index % intervalFactor === 0 ? [{ bucketStart, index }] : []
  );

  const groups = input.groups.map((group) => {
    const groupIds = getPublicStatusGroupRollupIds(group);
    const models = group.models.map((model) => {
      const aggregateBuckets = displayBuckets.map((displayBucket) => {
        const slice = bucketStarts.slice(displayBucket.index, displayBucket.index + intervalFactor);
        return slice.reduce(
          (acc, bucketStart) => {
            const bucket = bucketByStart.get(bucketStart);
            if (!bucket) {
              return acc;
            }

            for (const groupId of groupIds) {
              acc.successCount += getRollupValue({
                bucket,
                groupId,
                modelKey: model.publicModelKey,
                metric: "success",
              });
              acc.failureCount += getRollupValue({
                bucket,
                groupId,
                modelKey: model.publicModelKey,
                metric: "failure",
              });
              acc.ttfbSum += getRollupValue({
                bucket,
                groupId,
                modelKey: model.publicModelKey,
                metric: "ttfb_sum",
              });
              acc.ttfbCount += getRollupValue({
                bucket,
                groupId,
                modelKey: model.publicModelKey,
                metric: "ttfb_count",
              });
              acc.tpsSum += getRollupValue({
                bucket,
                groupId,
                modelKey: model.publicModelKey,
                metric: "tps_sum",
              });
              acc.tpsCount += getRollupValue({
                bucket,
                groupId,
                modelKey: model.publicModelKey,
                metric: "tps_count",
              });
            }
            return acc;
          },
          {
            bucketStart: displayBucket.bucketStart,
            successCount: 0,
            failureCount: 0,
            ttfbSum: 0,
            ttfbCount: 0,
            tpsSum: 0,
            tpsCount: 0,
          }
        );
      });

      const rawTimeline = aggregateBuckets.map((bucket) => {
        const total = bucket.successCount + bucket.failureCount;
        if (total <= 0) {
          return null;
        }
        return bucket.successCount > 0 ? "operational" : "failed";
      });
      const filledTimeline = applyBoundedGapFill({ timeline: rawTimeline });

      let latestTtfbMs: number | null = null;
      let latestTps: number | null = null;
      const timeline: PublicStatusTimelineBucket[] = aggregateBuckets.map((bucket, index) => {
        const bucketStartMs = Date.parse(bucket.bucketStart);
        const total = bucket.successCount + bucket.failureCount;
        const availabilityPct =
          total <= 0
            ? filledTimeline[index] === "operational"
              ? 100
              : filledTimeline[index] === "failed"
                ? 0
                : null
            : Number(((bucket.successCount / total) * 100).toFixed(2));
        const ttfbMs = average(bucket.ttfbSum, bucket.ttfbCount);
        const tps = average(bucket.tpsSum, bucket.tpsCount);

        if (ttfbMs !== null) {
          latestTtfbMs = ttfbMs;
        }
        if (tps !== null) {
          latestTps = tps;
        }

        return {
          bucketStart: bucket.bucketStart,
          bucketEnd: new Date(bucketStartMs + input.intervalMinutes * 60 * 1000).toISOString(),
          state:
            filledTimeline[index] === "operational"
              ? "operational"
              : filledTimeline[index] === "failed"
                ? "failed"
                : "no_data",
          availabilityPct,
          ttfbMs,
          tps,
          sampleCount: total,
        };
      });

      const totalSuccess = aggregateBuckets.reduce((sum, bucket) => sum + bucket.successCount, 0);
      const totalFailure = aggregateBuckets.reduce((sum, bucket) => sum + bucket.failureCount, 0);
      const totalCount = totalSuccess + totalFailure;
      const availabilityPct =
        totalCount <= 0 ? null : Number(((totalSuccess / totalCount) * 100).toFixed(2));
      const latestKnownBucket =
        [...aggregateBuckets].reverse().find((bucket) => {
          const total = bucket.successCount + bucket.failureCount;
          return total > 0;
        }) ?? null;
      const latestBucketAvailabilityPct = latestKnownBucket
        ? (latestKnownBucket.successCount /
            (latestKnownBucket.successCount + latestKnownBucket.failureCount)) *
          100
        : null;
      const latestStateRaw =
        latestKnownBucket && latestKnownBucket.successCount <= 0
          ? "failed"
          : latestBucketAvailabilityPct !== null && latestBucketAvailabilityPct < 50
            ? "degraded"
            : ([...filledTimeline].reverse().find((state) => state !== null) ?? null);

      return {
        publicModelKey: model.publicModelKey,
        label: model.label,
        vendorIconKey: model.vendorIconKey,
        requestTypeBadge: model.requestTypeBadge,
        latestState:
          latestStateRaw === "operational"
            ? "operational"
            : latestStateRaw === "degraded"
              ? "degraded"
              : latestStateRaw === "failed"
                ? "failed"
                : "no_data",
        availabilityPct,
        latestTtfbMs,
        latestTps,
        timeline,
      } satisfies PublicStatusPayload["groups"][number]["models"][number];
    });

    return {
      publicGroupSlug: group.publicGroupSlug,
      displayName: group.displayName,
      explanatoryCopy: group.explanatoryCopy,
      models,
    } satisfies PublicStatusPayload["groups"][number];
  });

  return {
    generatedAt: coveredTo,
    coveredFrom,
    coveredTo,
    groups,
  };
}

export function buildPublicStatusRollupBucketStarts(input: {
  now: string | Date;
  rangeHours: number;
  intervalMinutes: number;
}): string[] {
  return buildBucketStarts(input).bucketStarts;
}

export { PUBLIC_STATUS_ROLLUP_BUCKET_MINUTES };
