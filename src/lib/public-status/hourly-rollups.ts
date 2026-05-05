import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { publicStatusHourlyRollups } from "@/drizzle/schema";
import {
  classifyProviderChainItemOutcome,
  resolveSuccessRateModelKey,
} from "@/lib/request-outcome";
import { resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import type { PublicStatusConfiguredGroup, PublicStatusRequestRow } from "./aggregation";
import {
  applyBoundedGapFill,
  computeTokensPerSecond,
  queryPublicStatusRequests,
} from "./aggregation";
import type {
  PublicStatusGroupSnapshot,
  PublicStatusPayload,
  PublicStatusTimelineBucket,
  PublicStatusTimelineState,
} from "./payload";
import { buildGenerationFingerprint } from "./redis-contract";

export const PUBLIC_STATUS_ROLLUP_RETENTION_DAYS = 30;
export const PUBLIC_STATUS_CURRENT_HOUR_CACHE_TTL_SECONDS = 10 * 60;
export const PUBLIC_STATUS_DEGRADED_AVAILABILITY_THRESHOLD = 99.9;

export interface PublicStatusHourlyRollupRow {
  bucketStart: Date;
  bucketEnd: Date;
  configVersion: string;
  sourceGroupName: string;
  publicGroupSlug: string;
  publicModelKey: string;
  label: string;
  vendorIconKey: string;
  requestTypeBadge: string;
  state: "operational" | "degraded" | "failed" | "no_data";
  successCount: number;
  failureCount: number;
  sampleCount: number;
  availabilityPct: number | null;
  ttfbMs: number | null;
  tps: number | null;
  generatedAt: Date;
}

interface RedisCurrentHourCache {
  get?(key: string): Promise<string | null> | string | null;
  set?(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> | unknown;
  status?: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const result =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : sorted[middle];

  return result === undefined ? null : Number(result.toFixed(4));
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getReadyRedis(redis?: RedisCurrentHourCache | null): RedisCurrentHourCache | null {
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    return null;
  }
  return redis;
}

export function alignHourStartUtc(input: string | Date): Date {
  const date = input instanceof Date ? input : new Date(input);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      0,
      0,
      0
    )
  );
}

export function buildPublicStatusCurrentHourSummaryKey(input: {
  configVersion: string;
  hourStart: string | Date;
}): string {
  return [
    "public-status:v1",
    "current-hour",
    encodeURIComponent(input.configVersion),
    alignHourStartUtc(input.hourStart).toISOString(),
  ].join(":");
}

function deriveRollupState(input: {
  sampleCount: number;
  availabilityPct: number | null;
}): PublicStatusHourlyRollupRow["state"] {
  if (input.sampleCount === 0 || input.availabilityPct === null) {
    return "no_data";
  }
  if (input.availabilityPct === 0) {
    return "failed";
  }
  return input.availabilityPct >= PUBLIC_STATUS_DEGRADED_AVAILABILITY_THRESHOLD
    ? "operational"
    : "degraded";
}

export function buildPublicStatusHourlyRollupsFromRequests(input: {
  configVersion: string;
  hourStart: string | Date;
  groups: PublicStatusConfiguredGroup[];
  requests: PublicStatusRequestRow[];
  generatedAt?: string | Date;
}): PublicStatusHourlyRollupRow[] {
  const bucketStart = alignHourStartUtc(input.hourStart);
  const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
  const generatedAt =
    input.generatedAt instanceof Date
      ? input.generatedAt
      : input.generatedAt
        ? new Date(input.generatedAt)
        : new Date();

  type MutableBucket = {
    successCount: number;
    failureCount: number;
    ttfbValues: number[];
    tpsValues: number[];
  };

  const mutable = new Map<string, MutableBucket>();
  const keyFor = (groupSlug: string, modelKey: string, badge: string) =>
    `${groupSlug}\u0000${modelKey}\u0000${badge}`;

  for (const group of input.groups) {
    for (const model of group.models) {
      mutable.set(keyFor(group.publicGroupSlug, model.publicModelKey, model.requestTypeBadge), {
        successCount: 0,
        failureCount: 0,
        ttfbValues: [],
        tpsValues: [],
      });
    }
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
    const modelKey = resolveSuccessRateModelKey({
      originalModel: request.originalModel,
      model: request.model,
    });
    if (!modelKey) {
      continue;
    }

    const requestTime =
      request.createdAt instanceof Date
        ? request.createdAt.getTime()
        : new Date(request.createdAt).getTime();
    if (
      !Number.isFinite(requestTime) ||
      requestTime < bucketStart.getTime() ||
      requestTime >= bucketEnd.getTime()
    ) {
      continue;
    }

    const groups = modelToGroups.get(modelKey);
    if (!groups) {
      continue;
    }

    const groupOutcome = new Map<string, "success" | "failure" | "excluded">();
    for (const item of request.providerChain ?? []) {
      const outcome = classifyProviderChainItemOutcome({
        statusCode: item.statusCode ?? undefined,
        reason: item.reason ?? undefined,
        errorMessage: item.errorMessage ?? undefined,
        errorDetails: item.matchedRule ? { matchedRule: item.matchedRule } : undefined,
      })?.outcome;
      if (!outcome) {
        continue;
      }

      for (const sourceGroupName of new Set(resolveProviderGroupsWithDefault(item.groupTag))) {
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

    for (const group of groups) {
      const outcome = groupOutcome.get(group.sourceGroupName);
      if (!outcome || outcome === "excluded") {
        continue;
      }

      const model = group.models.find((candidate) => candidate.publicModelKey === modelKey);
      if (!model) {
        continue;
      }
      const bucket = mutable.get(
        keyFor(group.publicGroupSlug, model.publicModelKey, model.requestTypeBadge)
      );
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

  return input.groups.flatMap((group) =>
    group.models.map((model) => {
      const bucket = mutable.get(
        keyFor(group.publicGroupSlug, model.publicModelKey, model.requestTypeBadge)
      ) ?? {
        successCount: 0,
        failureCount: 0,
        ttfbValues: [],
        tpsValues: [],
      };
      const sampleCount = bucket.successCount + bucket.failureCount;
      const availabilityPct =
        sampleCount === 0 ? null : Number(((bucket.successCount / sampleCount) * 100).toFixed(2));
      return {
        bucketStart,
        bucketEnd,
        configVersion: input.configVersion,
        sourceGroupName: group.sourceGroupName,
        publicGroupSlug: group.publicGroupSlug,
        publicModelKey: model.publicModelKey,
        label: model.label,
        vendorIconKey: model.vendorIconKey,
        requestTypeBadge: model.requestTypeBadge,
        state: deriveRollupState({ sampleCount, availabilityPct }),
        successCount: bucket.successCount,
        failureCount: bucket.failureCount,
        sampleCount,
        availabilityPct,
        ttfbMs: median(bucket.ttfbValues),
        tps: median(bucket.tpsValues),
        generatedAt,
      };
    })
  );
}

export async function buildAndPersistPublicStatusHourlyRollup(input: {
  configVersion: string;
  hourStart: string | Date;
  groups: PublicStatusConfiguredGroup[];
}): Promise<PublicStatusHourlyRollupRow[]> {
  const hourStart = alignHourStartUtc(input.hourStart);
  const requests = await queryPublicStatusRequests({
    groups: input.groups,
    coveredFrom: hourStart,
    coveredTo: new Date(hourStart.getTime() + 60 * 60 * 1000),
  });
  const rollups = buildPublicStatusHourlyRollupsFromRequests({
    configVersion: input.configVersion,
    hourStart,
    groups: input.groups,
    requests,
  });
  await upsertPublicStatusHourlyRollups(rollups);
  return rollups;
}

export async function upsertPublicStatusHourlyRollups(
  rows: PublicStatusHourlyRollupRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await db
    .insert(publicStatusHourlyRollups)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        publicStatusHourlyRollups.bucketStart,
        publicStatusHourlyRollups.publicGroupSlug,
        publicStatusHourlyRollups.publicModelKey,
        publicStatusHourlyRollups.requestTypeBadge,
      ],
      set: {
        bucketEnd: sql`excluded.bucket_end`,
        configVersion: sql`excluded.config_version`,
        sourceGroupName: sql`excluded.source_group_name`,
        label: sql`excluded.label`,
        vendorIconKey: sql`excluded.vendor_icon_key`,
        state: sql`excluded.state`,
        successCount: sql`excluded.success_count`,
        failureCount: sql`excluded.failure_count`,
        sampleCount: sql`excluded.sample_count`,
        availabilityPct: sql`excluded.availability_pct`,
        ttfbMs: sql`excluded.ttfb_ms`,
        tps: sql`excluded.tps`,
        generatedAt: sql`excluded.generated_at`,
        updatedAt: sql`now()`,
      },
    });
}

export async function readPublicStatusHourlyRollups(input: {
  start: Date;
  end: Date;
  configVersion?: string;
}): Promise<PublicStatusHourlyRollupRow[]> {
  const conditions = [
    gte(publicStatusHourlyRollups.bucketStart, input.start),
    lt(publicStatusHourlyRollups.bucketStart, input.end),
  ];
  if (input.configVersion) {
    conditions.push(eq(publicStatusHourlyRollups.configVersion, input.configVersion));
  }

  const rows = await db
    .select()
    .from(publicStatusHourlyRollups)
    .where(and(...conditions))
    .orderBy(
      asc(publicStatusHourlyRollups.bucketStart),
      asc(publicStatusHourlyRollups.publicGroupSlug),
      asc(publicStatusHourlyRollups.publicModelKey)
    );

  return rows.map((row) => ({
    bucketStart: row.bucketStart,
    bucketEnd: row.bucketEnd,
    configVersion: row.configVersion,
    sourceGroupName: row.sourceGroupName,
    publicGroupSlug: row.publicGroupSlug,
    publicModelKey: row.publicModelKey,
    label: row.label,
    vendorIconKey: row.vendorIconKey,
    requestTypeBadge: row.requestTypeBadge,
    state: row.state,
    successCount: row.successCount,
    failureCount: row.failureCount,
    sampleCount: row.sampleCount,
    availabilityPct: normalizeFiniteNumber(row.availabilityPct),
    ttfbMs: normalizeFiniteNumber(row.ttfbMs),
    tps: normalizeFiniteNumber(row.tps),
    generatedAt: row.generatedAt,
  }));
}

export async function cleanupPublicStatusHourlyRollups(
  input: { now?: Date; retentionDays?: number } = {}
): Promise<void> {
  const now = input.now ?? new Date();
  const retentionDays = input.retentionDays ?? PUBLIC_STATUS_ROLLUP_RETENTION_DAYS;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  cutoff.setUTCHours(0, 0, 0, 0);

  await db
    .delete(publicStatusHourlyRollups)
    .where(lte(publicStatusHourlyRollups.bucketEnd, cutoff));
}

export async function writeCurrentHourPublicStatusSummary(input: {
  redis?: RedisCurrentHourCache | null;
  configVersion: string;
  hourStart: string | Date;
  rows: PublicStatusHourlyRollupRow[];
  ttlSeconds?: number;
}): Promise<boolean> {
  const redis = getReadyRedis(input.redis);
  if (!redis || typeof redis.set !== "function") {
    return false;
  }

  const key = buildPublicStatusCurrentHourSummaryKey({
    configVersion: input.configVersion,
    hourStart: input.hourStart,
  });
  await redis.set(
    key,
    JSON.stringify({
      configVersion: input.configVersion,
      hourStart: alignHourStartUtc(input.hourStart).toISOString(),
      rows: input.rows.map(serializeRollupRow),
    }),
    "EX",
    input.ttlSeconds ?? PUBLIC_STATUS_CURRENT_HOUR_CACHE_TTL_SECONDS
  );
  return true;
}

export async function readCurrentHourPublicStatusSummary(input: {
  redis?: RedisCurrentHourCache | null;
  configVersion: string;
  hourStart: string | Date;
}): Promise<PublicStatusHourlyRollupRow[]> {
  const redis = getReadyRedis(input.redis);
  if (!redis || typeof redis.get !== "function") {
    return [];
  }

  const key = buildPublicStatusCurrentHourSummaryKey({
    configVersion: input.configVersion,
    hourStart: input.hourStart,
  });
  let raw: string | null = null;
  try {
    raw = await redis.get(key);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as { rows?: unknown };
    if (!Array.isArray(parsed.rows)) {
      return [];
    }
    return parsed.rows.flatMap(parseSerializedRollupRow);
  } catch {
    return [];
  }
}

export function buildPublicStatusPayloadFromHourlyRollups(input: {
  groups: PublicStatusConfiguredGroup[];
  rows: PublicStatusHourlyRollupRow[];
  rangeHours: number;
  now: string | Date;
  configVersion?: string;
  intervalMinutes?: number;
}): PublicStatusPayload {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const currentHourStart = alignHourStartUtc(now);
  const windowStart = new Date(
    currentHourStart.getTime() - (input.rangeHours - 1) * 60 * 60 * 1000
  );
  const bucketCount = input.rangeHours;
  const rowsByKey = new Map<string, PublicStatusHourlyRollupRow>();
  for (const row of input.rows) {
    rowsByKey.set(
      `${row.bucketStart.toISOString()}\u0000${row.publicGroupSlug}\u0000${row.publicModelKey}\u0000${row.requestTypeBadge}`,
      row
    );
  }

  const generatedAt =
    input.rows
      .map((row) => row.generatedAt.getTime())
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0] ?? now.getTime();
  const coveredFrom = windowStart.toISOString();
  const coveredTo = new Date(currentHourStart.getTime() + 60 * 60 * 1000).toISOString();

  const groups: PublicStatusGroupSnapshot[] = input.groups.map((group) => ({
    publicGroupSlug: group.publicGroupSlug,
    displayName: group.displayName,
    explanatoryCopy: group.explanatoryCopy,
    models: group.models.map((model) => {
      const rawStates: Array<"operational" | "failed" | null> = [];
      const rowSlots: Array<PublicStatusHourlyRollupRow | null> = [];
      for (let index = 0; index < bucketCount; index++) {
        const bucketStart = new Date(windowStart.getTime() + index * 60 * 60 * 1000);
        const row =
          rowsByKey.get(
            `${bucketStart.toISOString()}\u0000${group.publicGroupSlug}\u0000${model.publicModelKey}\u0000${model.requestTypeBadge}`
          ) ?? null;
        rowSlots.push(row);
        rawStates.push(
          row && row.sampleCount > 0 ? (row.state === "failed" ? "failed" : "operational") : null
        );
      }

      const filledTimeline = applyBoundedGapFill({ timeline: rawStates });
      let latestTtfbMs: number | null = null;
      let latestTps: number | null = null;
      let totalSuccess = 0;
      let totalSamples = 0;

      const timeline: PublicStatusTimelineBucket[] = rowSlots.map((row, index) => {
        const bucketStart = new Date(windowStart.getTime() + index * 60 * 60 * 1000);
        const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
        if (row) {
          totalSuccess += row.successCount;
          totalSamples += row.sampleCount;
          if (row.ttfbMs !== null) {
            latestTtfbMs = row.ttfbMs;
          }
          if (row.tps !== null) {
            latestTps = row.tps;
          }
        }

        const sampleCount = row?.sampleCount ?? 0;
        const state: PublicStatusTimelineState =
          row && sampleCount > 0
            ? row.state
            : filledTimeline[index] === "operational"
              ? "operational"
              : filledTimeline[index] === "failed"
                ? "failed"
                : "no_data";

        return {
          bucketStart: bucketStart.toISOString(),
          bucketEnd: bucketEnd.toISOString(),
          state,
          availabilityPct:
            row?.availabilityPct ??
            (sampleCount === 0
              ? filledTimeline[index] === "operational"
                ? 100
                : filledTimeline[index] === "failed"
                  ? 0
                  : null
              : null),
          ttfbMs: row?.ttfbMs ?? null,
          tps: row?.tps ?? null,
          sampleCount,
        };
      });

      const latestStateRaw = [...filledTimeline].reverse().find((state) => state !== null) ?? null;
      const latestRowState =
        [...rowSlots].reverse().find((row) => row && row.sampleCount > 0)?.state ?? null;
      return {
        publicModelKey: model.publicModelKey,
        label: model.label,
        vendorIconKey: model.vendorIconKey,
        requestTypeBadge: model.requestTypeBadge,
        latestState:
          latestRowState ??
          (latestStateRaw === "operational"
            ? "operational"
            : latestStateRaw === "failed"
              ? "failed"
              : "no_data"),
        availabilityPct:
          totalSamples === 0 ? null : Number(((totalSuccess / totalSamples) * 100).toFixed(2)),
        latestTtfbMs,
        latestTps,
        timeline,
      };
    }),
  }));

  return {
    rebuildState: input.rows.length > 0 ? "fresh" : "no-data",
    sourceGeneration: buildGenerationFingerprint({
      configVersion: input.configVersion ?? "db-rollup",
      intervalMinutes: input.intervalMinutes ?? 60,
      coveredFromIso: coveredFrom,
      coveredToIso: coveredTo,
    }),
    generatedAt: new Date(generatedAt).toISOString(),
    freshUntil: new Date(currentHourStart.getTime() + 60 * 60 * 1000).toISOString(),
    groups,
  };
}

function serializeRollupRow(row: PublicStatusHourlyRollupRow): Record<string, unknown> {
  return {
    ...row,
    bucketStart: row.bucketStart.toISOString(),
    bucketEnd: row.bucketEnd.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
  };
}

function parseSerializedRollupRow(input: unknown): PublicStatusHourlyRollupRow[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.bucketStart !== "string" ||
    typeof value.bucketEnd !== "string" ||
    typeof value.configVersion !== "string" ||
    typeof value.sourceGroupName !== "string" ||
    typeof value.publicGroupSlug !== "string" ||
    typeof value.publicModelKey !== "string" ||
    typeof value.label !== "string" ||
    typeof value.vendorIconKey !== "string" ||
    typeof value.requestTypeBadge !== "string" ||
    (value.state !== "operational" &&
      value.state !== "degraded" &&
      value.state !== "failed" &&
      value.state !== "no_data") ||
    typeof value.successCount !== "number" ||
    typeof value.failureCount !== "number" ||
    typeof value.sampleCount !== "number" ||
    typeof value.generatedAt !== "string"
  ) {
    return [];
  }

  return [
    {
      bucketStart: new Date(value.bucketStart),
      bucketEnd: new Date(value.bucketEnd),
      configVersion: value.configVersion,
      sourceGroupName: value.sourceGroupName,
      publicGroupSlug: value.publicGroupSlug,
      publicModelKey: value.publicModelKey,
      label: value.label,
      vendorIconKey: value.vendorIconKey,
      requestTypeBadge: value.requestTypeBadge,
      state: value.state,
      successCount: value.successCount,
      failureCount: value.failureCount,
      sampleCount: value.sampleCount,
      availabilityPct: normalizeFiniteNumber(value.availabilityPct),
      ttfbMs: normalizeFiniteNumber(value.ttfbMs),
      tps: normalizeFiniteNumber(value.tps),
      generatedAt: new Date(value.generatedAt),
    },
  ];
}
