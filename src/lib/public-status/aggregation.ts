import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest, providers } from "@/drizzle/schema";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import { EXCLUDE_WARMUP_CONDITION } from "@/repository/_shared/message-request-conditions";
import type { PublicStatusPayload, PublicStatusTimelineBucket } from "./payload";
import type { PublicStatusConfigSnapshot } from "./config-snapshot";

export interface PublicStatusFailureSignal {
  statusCode?: number;
  reason?: string;
  errorMessage?: string;
  matchedRule?: {
    ruleId: number;
    pattern: string;
    matchType: string;
    category: string;
    hasOverrideResponse: boolean;
    hasOverrideStatusCode: boolean;
  };
}

export interface PublicStatusRequestChainItem extends PublicStatusFailureSignal {
  id: number;
  name: string;
  groupTag?: string | null;
  providerType?: string | null;
}

export interface PublicStatusRequestRow {
  id: number;
  createdAt: string | Date;
  model?: string | null;
  originalModel?: string | null;
  durationMs?: number | null;
  ttfbMs?: number | null;
  outputTokens?: number | null;
  providerChain?: PublicStatusRequestChainItem[] | null;
}

export interface PublicStatusConfiguredGroup {
  sourceGroupName: string;
  publicGroupSlug: string;
  displayName: string;
  explanatoryCopy: string | null;
  sortOrder: number;
  models: Array<{
    publicModelKey: string;
    label: string;
    vendorIconKey: string;
    requestTypeBadge: string;
  }>;
}

export interface PublicStatusAggregationResult {
  generatedAt: string;
  coveredFrom: string;
  coveredTo: string;
  groups: PublicStatusPayload["groups"];
}

export function getConfiguredPublicStatusGroups(
  snapshot: PublicStatusConfigSnapshot
): PublicStatusConfiguredGroup[] {
  return snapshot.groups
    .filter(
      (group) =>
        typeof group.sourceGroupName === "string" &&
        group.sourceGroupName.trim().length > 0 &&
        Array.isArray(group.models) &&
        group.models.length > 0
    )
    .map((group) => ({
      sourceGroupName: group.sourceGroupName!.trim(),
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
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName)
    );
}

export function computeTokensPerSecond(input: {
  outputTokens?: number | null;
  durationMs?: number | null;
  ttfbMs?: number | null;
}): number | null {
  if (!input.outputTokens || input.outputTokens <= 0) {
    return null;
  }

  if (!input.durationMs || input.durationMs <= 0) {
    return null;
  }

  const generationMs = input.durationMs - (input.ttfbMs ?? 0);
  if (generationMs <= 0) {
    return null;
  }

  return Number((input.outputTokens / (generationMs / 1000)).toFixed(4));
}

export function isExcludedFromPublicStatusFailure(signal: PublicStatusFailureSignal): boolean {
  if (signal.statusCode === 404 || signal.statusCode === 499) {
    return true;
  }

  if (signal.matchedRule) {
    return true;
  }

  if (
    signal.reason === "resource_not_found" ||
    signal.reason === "concurrent_limit_failed" ||
    signal.reason === "hedge_loser_cancelled" ||
    signal.reason === "client_error_non_retryable"
  ) {
    return true;
  }

  const normalizedError = signal.errorMessage?.toLowerCase() ?? "";
  if (
    normalizedError.includes("no available provider") ||
    normalizedError.includes("insufficient quota") ||
    normalizedError.includes("quota exceeded") ||
    normalizedError.includes("rate limit") ||
    normalizedError.includes("rate_limit") ||
    normalizedError.includes("concurrency limit") ||
    normalizedError.includes("concurrent limit") ||
    normalizedError.includes("limit exceeded")
  ) {
    return true;
  }

  return false;
}

function isSuccessReason(reason: string | undefined, statusCode?: number): boolean {
  if (reason === "request_success" || reason === "retry_success" || reason === "hedge_winner") {
    return true;
  }

  return statusCode !== undefined && statusCode >= 200 && statusCode < 400;
}

function alignWindowEnd(now: Date, intervalMinutes: number): Date {
  const bucketMs = intervalMinutes * 60 * 1000;
  return new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(4));
  }

  return sorted[middle] ?? null;
}

export function applyBoundedGapFill(input: {
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

// 核心聚合逻辑保持纯函数，便于 worker/scheduler 和测试复用。
export function buildPublicStatusPayloadFromRequests(input: {
  rangeHours: number;
  intervalMinutes: number;
  now: string | Date;
  groups: PublicStatusConfiguredGroup[];
  requests: PublicStatusRequestRow[];
}): PublicStatusAggregationResult {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const bucketMs = input.intervalMinutes * 60 * 1000;
  const bucketCount = Math.ceil((input.rangeHours * 60) / input.intervalMinutes);
  const windowEnd = alignWindowEnd(now, input.intervalMinutes);
  const windowStartMs = windowEnd.getTime() - bucketCount * bucketMs;

  type MutableBucket = {
    successCount: number;
    failureCount: number;
    ttfbValues: number[];
    tpsValues: number[];
  };

  const groupMaps = new Map<
    string,
    {
      publicGroupSlug: string;
      displayName: string;
      explanatoryCopy: string | null;
      sortOrder: number;
      models: Map<
        string,
        {
          label: string;
          vendorIconKey: string;
          requestTypeBadge: string;
          buckets: MutableBucket[];
        }
      >;
    }
  >();

  for (const group of input.groups) {
    groupMaps.set(group.sourceGroupName, {
      publicGroupSlug: group.publicGroupSlug,
      displayName: group.displayName,
      explanatoryCopy: group.explanatoryCopy,
      sortOrder: group.sortOrder,
      models: new Map(
        group.models.map((model) => [
          model.publicModelKey,
          {
            label: model.label,
            vendorIconKey: model.vendorIconKey,
            requestTypeBadge: model.requestTypeBadge,
            buckets: Array.from({ length: bucketCount }, () => ({
              successCount: 0,
              failureCount: 0,
              ttfbValues: [],
              tpsValues: [],
            })),
          },
        ])
      ),
    });
  }

  const modelToGroups = new Map<string, PublicStatusConfiguredGroup[]>();
  for (const group of input.groups) {
    for (const model of group.models) {
      const existing = modelToGroups.get(model.publicModelKey) ?? [];
      existing.push(group);
      modelToGroups.set(model.publicModelKey, existing);
    }
  }

  for (const request of input.requests) {
    const modelKey = request.originalModel ?? request.model ?? null;
    if (!modelKey) {
      continue;
    }

    const configuredGroups = modelToGroups.get(modelKey);
    if (!configuredGroups || configuredGroups.length === 0) {
      continue;
    }

    const createdAtMs =
      request.createdAt instanceof Date
        ? request.createdAt.getTime()
        : new Date(request.createdAt).getTime();
    if (
      !Number.isFinite(createdAtMs) ||
      createdAtMs < windowStartMs ||
      createdAtMs >= windowEnd.getTime()
    ) {
      continue;
    }

    const bucketIndex = Math.floor((createdAtMs - windowStartMs) / bucketMs);
    if (bucketIndex < 0 || bucketIndex >= bucketCount) {
      continue;
    }

    const groupOutcome = new Map<string, "success" | "failure" | "excluded">();
    for (const item of request.providerChain ?? []) {
      const itemGroups = Array.from(new Set(parseProviderGroups(item.groupTag)));
      if (itemGroups.length === 0) {
        continue;
      }

      const outcome = (() => {
        if (
          isExcludedFromPublicStatusFailure({
            statusCode: item.statusCode,
            reason: item.reason,
            errorMessage: item.errorMessage,
            matchedRule: item.matchedRule,
          })
        ) {
          return "excluded" as const;
        }

        if (isSuccessReason(item.reason, item.statusCode)) {
          return "success" as const;
        }

        if (item.statusCode !== undefined || item.reason) {
          return "failure" as const;
        }

        return null;
      })();

      if (!outcome) {
        continue;
      }

      for (const sourceGroupName of itemGroups) {
        if (!groupMaps.has(sourceGroupName)) {
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

    const tps = computeTokensPerSecond({
      outputTokens: request.outputTokens,
      durationMs: request.durationMs,
      ttfbMs: request.ttfbMs,
    });

    for (const [sourceGroupName, outcome] of groupOutcome.entries()) {
      if (outcome === "excluded") {
        continue;
      }

      const bucket = groupMaps.get(sourceGroupName)?.models.get(modelKey)?.buckets[bucketIndex];
      if (!bucket) {
        continue;
      }

      if (outcome === "success") {
        bucket.successCount += 1;
      } else {
        bucket.failureCount += 1;
      }

      if (typeof request.ttfbMs === "number") {
        bucket.ttfbValues.push(request.ttfbMs);
      }
      if (typeof tps === "number") {
        bucket.tpsValues.push(tps);
      }
    }
  }

  const groups = input.groups.map((group) => {
    const modelEntries = group.models.map((model) => {
      const modelState = groupMaps.get(group.sourceGroupName)?.models.get(model.publicModelKey);
      const rawTimeline =
        modelState?.buckets.map((bucket) => {
          const total = bucket.successCount + bucket.failureCount;
          if (total === 0) {
            return null;
          }

          return bucket.successCount > 0 ? "operational" : "failed";
        }) ?? Array.from({ length: bucketCount }, () => null);

      const filledTimeline = applyBoundedGapFill({
        timeline: rawTimeline,
      });

      let latestTtfbMs: number | null = null;
      let latestTps: number | null = null;

      const timeline: PublicStatusTimelineBucket[] = (modelState?.buckets ?? []).map(
        (bucket, index) => {
          const bucketStart = new Date(windowStartMs + index * bucketMs);
          const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
          const total = bucket.successCount + bucket.failureCount;
          const availabilityPct =
            total === 0
              ? filledTimeline[index] === "operational"
                ? 100
                : filledTimeline[index] === "failed"
                  ? 0
                  : null
              : Number(((bucket.successCount / total) * 100).toFixed(2));
          const ttfbMs = median(bucket.ttfbValues);
          const computedTps = median(bucket.tpsValues);

          if (ttfbMs !== null) {
            latestTtfbMs = ttfbMs;
          }
          if (computedTps !== null) {
            latestTps = computedTps;
          }

          return {
            bucketStart: bucketStart.toISOString(),
            bucketEnd: bucketEnd.toISOString(),
            state:
              filledTimeline[index] === "operational"
                ? "operational"
                : filledTimeline[index] === "failed"
                  ? "failed"
                  : "no_data",
            availabilityPct,
            ttfbMs,
            tps: computedTps,
            sampleCount: total,
          };
        }
      );

      const totalSuccess =
        modelState?.buckets.reduce((sum, bucket) => sum + bucket.successCount, 0) ?? 0;
      const totalFailure =
        modelState?.buckets.reduce((sum, bucket) => sum + bucket.failureCount, 0) ?? 0;
      const totalCount = totalSuccess + totalFailure;
      const availabilityPct =
        totalCount === 0 ? null : Number(((totalSuccess / totalCount) * 100).toFixed(2));
      const latestStateRaw = [...filledTimeline].reverse().find((state) => state !== null) ?? null;
      const latestState =
        latestStateRaw === "operational"
          ? ("operational" as const)
          : latestStateRaw === "failed"
            ? ("failed" as const)
            : ("no_data" as const);

      return {
        publicModelKey: model.publicModelKey,
        label: modelState?.label ?? model.label,
        vendorIconKey: modelState?.vendorIconKey ?? model.vendorIconKey,
        requestTypeBadge: modelState?.requestTypeBadge ?? model.requestTypeBadge,
        latestState,
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
      models: modelEntries,
    } satisfies PublicStatusPayload["groups"][number];
  });

  return {
    generatedAt: windowEnd.toISOString(),
    coveredFrom: new Date(windowStartMs).toISOString(),
    coveredTo: windowEnd.toISOString(),
    groups,
  };
}

export async function queryPublicStatusRequests(input: {
  groups: PublicStatusConfiguredGroup[];
  coveredFrom: Date;
  coveredTo: Date;
}): Promise<PublicStatusRequestRow[]> {
  const targetModelKeys = Array.from(
    new Set(input.groups.flatMap((group) => group.models.map((model) => model.publicModelKey)))
  );
  if (targetModelKeys.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      model: messageRequest.model,
      originalModel: messageRequest.originalModel,
      durationMs: messageRequest.durationMs,
      ttfbMs: messageRequest.ttfbMs,
      outputTokens: messageRequest.outputTokens,
      statusCode: messageRequest.statusCode,
      errorMessage: messageRequest.errorMessage,
      providerChain: messageRequest.providerChain,
      providerId: messageRequest.providerId,
      providerName: providers.name,
      finalGroupTag: providers.groupTag,
      finalProviderType: providers.providerType,
    })
    .from(messageRequest)
    .leftJoin(providers, eq(messageRequest.providerId, providers.id))
    .where(
      and(
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION,
        sql`${messageRequest.statusCode} IS NOT NULL`,
        gte(messageRequest.createdAt, input.coveredFrom),
        lt(messageRequest.createdAt, input.coveredTo),
        or(
          inArray(messageRequest.originalModel, targetModelKeys),
          inArray(messageRequest.model, targetModelKeys)
        )
      )
    );

  return rows.flatMap((row) => {
    if (!row.createdAt) {
      return [];
    }

    const existingChain =
      Array.isArray(row.providerChain) && row.providerChain.length > 0
        ? (row.providerChain as PublicStatusRequestChainItem[])
        : null;

    const fallbackChain =
      row.providerId && row.finalGroupTag
        ? ([
            {
              id: row.providerId,
              name: row.providerName ?? `provider-${row.providerId}`,
              groupTag: row.finalGroupTag,
              providerType: row.finalProviderType ?? undefined,
              reason:
                typeof row.statusCode === "number" && row.statusCode >= 200 && row.statusCode < 400
                  ? "request_success"
                  : row.statusCode === 404
                    ? "resource_not_found"
                    : "retry_failed",
              statusCode: row.statusCode ?? undefined,
              errorMessage: row.errorMessage ?? undefined,
            },
          ] satisfies PublicStatusRequestChainItem[])
        : null;

    return [
      {
        id: row.id,
        createdAt: row.createdAt,
        model: row.model,
        originalModel: row.originalModel,
        durationMs: row.durationMs,
        ttfbMs: row.ttfbMs,
        outputTokens: row.outputTokens,
        providerChain: existingChain ?? fallbackChain,
      },
    ];
  });
}
