import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest, providers } from "@/drizzle/schema";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import { findLatestPricesByModels } from "@/repository/model-price";
import type { ProviderType } from "@/types/provider";
import type { EnabledPublicStatusGroup } from "./config";

export interface AggregatePublicStatusSnapshotInput {
  windowHours: number;
  bucketMinutes: number;
  groups: EnabledPublicStatusGroup[];
}

export interface PublicStatusSnapshotPayload {
  generatedAt: string;
  windowHours: number;
  bucketMinutes: number;
  groups: PublicStatusGroupSnapshot[];
}

export type PublicStatusTimelineState = "operational" | "failed" | null;

export interface PublicStatusTimelineBucket {
  bucketStart: string;
  bucketEnd: string;
  state: "operational" | "failed" | "no_data";
  availabilityPct: number | null;
  ttfbMs: number | null;
  tps: number | null;
  sampleCount: number;
}

export interface PublicStatusModelSnapshot {
  modelId: string;
  displayName: string;
  latestState: "operational" | "failed" | "no_data";
  availabilityPct: number | null;
  latestTtfbMs: number | null;
  latestTps: number | null;
  timeline: PublicStatusTimelineBucket[];
}

export interface PublicStatusGroupSnapshot {
  groupName: string;
  displayName: string;
  models: PublicStatusModelSnapshot[];
}

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
  providerType?: ProviderType;
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
  if (signal.statusCode === 499) {
    return true;
  }

  if (signal.statusCode === 404) {
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

export function applyBoundedGapFill(input: {
  timeline: PublicStatusTimelineState[];
  bucketMinutes: number;
}): PublicStatusTimelineState[] {
  const result = [...input.timeline];

  let lastKnownIndex = -1;
  for (let index = 0; index < input.timeline.length; index++) {
    const current = input.timeline[index];
    if (current === null) {
      continue;
    }

    if (lastKnownIndex >= 0) {
      const previous = input.timeline[lastKnownIndex];
      const gapBuckets = index - lastKnownIndex - 1;

      if (gapBuckets > 0 && previous !== null) {
        for (let fillIndex = lastKnownIndex + 1; fillIndex < index; fillIndex++) {
          result[fillIndex] = previous;
        }
      }
    }

    lastKnownIndex = index;
  }

  return result;
}

function isSuccessReason(reason: string | undefined, statusCode?: number): boolean {
  if (reason === "request_success" || reason === "retry_success" || reason === "hedge_winner") {
    return true;
  }

  return statusCode !== undefined && statusCode >= 200 && statusCode < 400;
}

function alignWindowEnd(now: Date, bucketMinutes: number): Date {
  const bucketMs = bucketMinutes * 60 * 1000;
  return new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(4));
  }

  return sorted[middle] ?? null;
}

export function buildPublicStatusSnapshotFromRequests(input: {
  windowHours: number;
  bucketMinutes: number;
  now: string | Date;
  groups: EnabledPublicStatusGroup[];
  requests: PublicStatusRequestRow[];
}): PublicStatusSnapshotPayload {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const bucketMs = input.bucketMinutes * 60 * 1000;
  const bucketCount = Math.ceil((input.windowHours * 60) / input.bucketMinutes);
  const windowEnd = alignWindowEnd(now, input.bucketMinutes);
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
      displayName: string;
      models: Map<string, { displayName: string; buckets: MutableBucket[] }>;
    }
  >();

  for (const group of input.groups) {
    groupMaps.set(group.groupName, {
      displayName: group.displayName,
      models: new Map(
        group.modelIds.map((modelId) => [
          modelId,
          {
            displayName: modelId,
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

  const modelToGroups = new Map<string, EnabledPublicStatusGroup[]>();
  for (const group of input.groups) {
    for (const modelId of group.modelIds) {
      const existing = modelToGroups.get(modelId) ?? [];
      existing.push(group);
      modelToGroups.set(modelId, existing);
    }
  }

  for (const request of input.requests) {
    const modelId = request.originalModel ?? request.model ?? null;
    if (!modelId) {
      continue;
    }

    const configuredGroups = modelToGroups.get(modelId);
    if (!configuredGroups || configuredGroups.length === 0) {
      continue;
    }

    const createdAt =
      request.createdAt instanceof Date
        ? request.createdAt.getTime()
        : new Date(request.createdAt).getTime();
    if (
      !Number.isFinite(createdAt) ||
      createdAt < windowStartMs ||
      createdAt >= windowEnd.getTime()
    ) {
      continue;
    }

    const bucketIndex = Math.floor((createdAt - windowStartMs) / bucketMs);
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

      for (const groupName of itemGroups) {
        if (!groupMaps.has(groupName)) {
          continue;
        }

        const existing = groupOutcome.get(groupName);
        if (existing === "success") {
          continue;
        }

        if (outcome === "success") {
          groupOutcome.set(groupName, "success");
          continue;
        }

        if (!existing || existing === "excluded") {
          groupOutcome.set(groupName, outcome);
        }
      }
    }

    const tps = computeTokensPerSecond({
      outputTokens: request.outputTokens,
      durationMs: request.durationMs,
      ttfbMs: request.ttfbMs,
    });

    for (const [groupName, outcome] of groupOutcome.entries()) {
      if (outcome === "excluded") {
        continue;
      }

      const bucket = groupMaps.get(groupName)?.models.get(modelId)?.buckets[bucketIndex];
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

  const groups: PublicStatusGroupSnapshot[] = input.groups.map((group) => {
    const modelEntries = group.modelIds.map((modelId) => {
      const modelState = groupMaps.get(group.groupName)?.models.get(modelId);
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
        bucketMinutes: input.bucketMinutes,
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

      return {
        modelId,
        displayName: modelState?.displayName ?? modelId,
        latestState:
          latestStateRaw === "operational"
            ? "operational"
            : latestStateRaw === "failed"
              ? "failed"
              : "no_data",
        availabilityPct,
        latestTtfbMs,
        latestTps,
        timeline,
      } satisfies PublicStatusModelSnapshot;
    });

    return {
      groupName: group.groupName,
      displayName: group.displayName,
      models: modelEntries,
    };
  });

  return {
    generatedAt: windowEnd.toISOString(),
    windowHours: input.windowHours,
    bucketMinutes: input.bucketMinutes,
    groups,
  };
}

export async function aggregatePublicStatusSnapshot(
  input: AggregatePublicStatusSnapshotInput
): Promise<PublicStatusSnapshotPayload> {
  const now = new Date();
  const alignedWindowEnd = alignWindowEnd(now, input.bucketMinutes);
  const windowStart = new Date(alignedWindowEnd.getTime() - input.windowHours * 60 * 60 * 1000);
  const targetModelIds = Array.from(new Set(input.groups.flatMap((group) => group.modelIds)));
  const latestPricesByModel = await findLatestPricesByModels(targetModelIds);

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
      blockedBy: messageRequest.blockedBy,
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
        gte(messageRequest.createdAt, windowStart),
        or(
          inArray(messageRequest.originalModel, targetModelIds),
          inArray(messageRequest.model, targetModelIds)
        ),
        sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`,
        sql`${messageRequest.statusCode} IS NOT NULL`
      )
    );

  const requests: PublicStatusRequestRow[] = rows.flatMap((row) => {
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

  const snapshot = buildPublicStatusSnapshotFromRequests({
    windowHours: input.windowHours,
    bucketMinutes: input.bucketMinutes,
    groups: input.groups,
    requests,
    now: alignedWindowEnd,
  });

  return {
    ...snapshot,
    groups: snapshot.groups.map((group) => ({
      ...group,
      models: group.models.map((model) => ({
        ...model,
        displayName:
          typeof latestPricesByModel.get(model.modelId)?.priceData.display_name === "string" &&
          String(latestPricesByModel.get(model.modelId)?.priceData.display_name).trim().length > 0
            ? String(latestPricesByModel.get(model.modelId)?.priceData.display_name).trim()
            : model.displayName,
      })),
    })),
  };
}
