import { getRedisClient } from "@/lib/redis";
import type {
  PublicStatusGroupSnapshot,
  PublicStatusModelSnapshot,
  PublicStatusPayload,
  PublicStatusTimelineBucket,
  PublicStatusTimelineState,
} from "./payload";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
  LEGACY_PUBLIC_STATUS_REDIS_PREFIX,
  type PublicStatusManifest,
  resolvePublicStatusManifestState,
} from "./redis-contract";

interface RedisReader {
  get(key: string): Promise<string | null> | string | null;
  status?: string;
}

interface PublicStatusSnapshotRecord {
  sourceGeneration: string;
  generatedAt: string;
  freshUntil: string;
  groups: unknown;
}

interface ProjectionReadResult {
  prefix?: string;
  selectedManifest: PublicStatusManifest;
  resolution: ReturnType<typeof resolvePublicStatusManifestState>;
  snapshot: PublicStatusSnapshotRecord;
}

interface ProjectionReadMiss {
  reason: "manifest-missing" | "snapshot-missing";
}

type ProjectionReadOutcome =
  | { ok: true; projection: ProjectionReadResult }
  | { ok: false; miss: ProjectionReadMiss };

async function safeGet(redis: RedisReader, key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function buildRebuildingPayload(): PublicStatusPayload {
  return {
    rebuildState: "rebuilding",
    sourceGeneration: "",
    generatedAt: null,
    freshUntil: null,
    groups: [],
  };
}

function buildNoDataPayload(): PublicStatusPayload {
  return {
    rebuildState: "no-data",
    sourceGeneration: "",
    generatedAt: null,
    freshUntil: null,
    groups: [],
  };
}

function normalizeTimelineState(value: unknown): PublicStatusTimelineState {
  if (
    value === "operational" ||
    value === "degraded" ||
    value === "failed" ||
    value === "no_data"
  ) {
    return value;
  }
  return "no_data";
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeTimelineBuckets(input: unknown): PublicStatusTimelineBucket[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((bucket) => {
    if (!bucket || typeof bucket !== "object") {
      return [];
    }

    const value = bucket as Record<string, unknown>;
    if (
      typeof value.bucketStart !== "string" ||
      typeof value.bucketEnd !== "string" ||
      typeof value.sampleCount !== "number" ||
      !Number.isFinite(value.sampleCount)
    ) {
      return [];
    }

    return [
      {
        bucketStart: value.bucketStart,
        bucketEnd: value.bucketEnd,
        state: normalizeTimelineState(value.state),
        availabilityPct: normalizeNullableNumber(value.availabilityPct),
        ttfbMs: normalizeNullableNumber(value.ttfbMs),
        tps: normalizeNullableNumber(value.tps),
        sampleCount: value.sampleCount,
      },
    ];
  });
}

function sanitizeModelSnapshots(input: unknown): PublicStatusModelSnapshot[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((model) => {
    if (!model || typeof model !== "object") {
      return [];
    }

    const value = model as Record<string, unknown>;
    if (
      typeof value.publicModelKey !== "string" ||
      typeof value.label !== "string" ||
      typeof value.vendorIconKey !== "string" ||
      typeof value.requestTypeBadge !== "string"
    ) {
      return [];
    }

    return [
      {
        publicModelKey: value.publicModelKey,
        label: value.label,
        vendorIconKey: value.vendorIconKey,
        requestTypeBadge: value.requestTypeBadge,
        latestState: normalizeTimelineState(value.latestState),
        availabilityPct: normalizeNullableNumber(value.availabilityPct),
        latestTtfbMs: normalizeNullableNumber(value.latestTtfbMs),
        latestTps: normalizeNullableNumber(value.latestTps),
        timeline: sanitizeTimelineBuckets(value.timeline),
      },
    ];
  });
}

// Redis 快照跨版本持久化，公开响应必须按白名单重建，避免内部字段泄漏到 /status。
function sanitizeGroupSnapshots(input: unknown): PublicStatusGroupSnapshot[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((group) => {
    if (!group || typeof group !== "object") {
      return [];
    }

    const value = group as Record<string, unknown>;
    if (typeof value.publicGroupSlug !== "string" || typeof value.displayName !== "string") {
      return [];
    }

    return [
      {
        publicGroupSlug: value.publicGroupSlug,
        displayName: value.displayName,
        explanatoryCopy: typeof value.explanatoryCopy === "string" ? value.explanatoryCopy : null,
        models: sanitizeModelSnapshots(value.models),
      },
    ];
  });
}

async function readProjection(input: {
  redis: RedisReader;
  intervalMinutes: number;
  rangeHours: number;
  nowIso: string;
  configVersion?: string;
  prefix?: string;
}): Promise<ProjectionReadOutcome> {
  const manifestConfigVersion = input.configVersion ?? "current";
  const manifest = parseJson<PublicStatusManifest>(
    await safeGet(
      input.redis,
      buildPublicStatusManifestKey({
        configVersion: manifestConfigVersion,
        intervalMinutes: input.intervalMinutes,
        rangeHours: input.rangeHours,
        prefix: input.prefix,
      })
    )
  );
  const currentManifest =
    manifestConfigVersion === "current"
      ? manifest
      : parseJson<PublicStatusManifest>(
          await safeGet(
            input.redis,
            buildPublicStatusManifestKey({
              configVersion: "current",
              intervalMinutes: input.intervalMinutes,
              rangeHours: input.rangeHours,
              prefix: input.prefix,
            })
          )
        );

  let selectedManifest = manifest;
  let resolution = resolvePublicStatusManifestState(selectedManifest, input.nowIso);

  if (!resolution.sourceGeneration && currentManifest) {
    selectedManifest = currentManifest;
    resolution = {
      ...resolvePublicStatusManifestState(currentManifest, input.nowIso),
      rebuildState: "stale",
    };
  }

  if (!selectedManifest || !resolution.sourceGeneration) {
    return { ok: false, miss: { reason: "manifest-missing" } };
  }

  const snapshotKey = buildPublicStatusCurrentSnapshotKey({
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    generation: resolution.sourceGeneration,
    prefix: input.prefix,
  });
  const snapshot = parseJson<PublicStatusSnapshotRecord>(await safeGet(input.redis, snapshotKey));

  if (!snapshot) {
    return { ok: false, miss: { reason: "snapshot-missing" } };
  }

  return {
    ok: true,
    projection: {
      prefix: input.prefix,
      selectedManifest,
      resolution,
      snapshot,
    },
  };
}

function projectionToPayload(input: {
  projection: ProjectionReadResult;
  rebuildState?: PublicStatusPayload["rebuildState"];
}): PublicStatusPayload {
  return {
    rebuildState: input.rebuildState ?? input.projection.resolution.rebuildState,
    sourceGeneration: input.projection.snapshot.sourceGeneration,
    generatedAt: input.projection.snapshot.generatedAt,
    freshUntil: input.projection.snapshot.freshUntil,
    groups: sanitizeGroupSnapshots(input.projection.snapshot.groups),
  };
}

export async function readPublicStatusPayload(input: {
  intervalMinutes: number;
  rangeHours: number;
  nowIso: string;
  configVersion?: string;
  hasConfiguredGroups?: boolean;
  redis?: RedisReader | null;
  triggerRebuildHint: (reason: string) => Promise<void> | void;
}): Promise<PublicStatusPayload> {
  if (input.hasConfiguredGroups === false) {
    return buildNoDataPayload();
  }

  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || ("status" in redis && redis.status && redis.status !== "ready")) {
    await input.triggerRebuildHint("redis-unavailable");
    return buildRebuildingPayload();
  }

  const primaryRead = await readProjection({
    redis,
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    nowIso: input.nowIso,
    configVersion: input.configVersion,
  });

  let projection = primaryRead.ok ? primaryRead.projection : null;
  let miss = primaryRead.ok ? null : primaryRead.miss;

  if (!projection) {
    const legacyRead = await readProjection({
      redis,
      intervalMinutes: input.intervalMinutes,
      rangeHours: input.rangeHours,
      nowIso: input.nowIso,
      configVersion: input.configVersion,
      prefix: LEGACY_PUBLIC_STATUS_REDIS_PREFIX,
    });
    projection = legacyRead.ok ? legacyRead.projection : null;
    if (!legacyRead.ok && miss?.reason !== "snapshot-missing") {
      miss = legacyRead.miss;
    }
  }

  if (!projection) {
    await input.triggerRebuildHint(miss?.reason ?? "manifest-missing");
    return buildRebuildingPayload();
  }

  if (
    projection.prefix !== LEGACY_PUBLIC_STATUS_REDIS_PREFIX &&
    projection.selectedManifest.rollupCoverageComplete === false
  ) {
    const legacyRead = await readProjection({
      redis,
      intervalMinutes: input.intervalMinutes,
      rangeHours: input.rangeHours,
      nowIso: input.nowIso,
      configVersion: input.configVersion,
      prefix: LEGACY_PUBLIC_STATUS_REDIS_PREFIX,
    });

    if (legacyRead.ok) {
      await input.triggerRebuildHint("rollup-coverage-incomplete");
      await input.triggerRebuildHint("legacy-generation");
      if (
        input.configVersion &&
        legacyRead.projection.selectedManifest.configVersion !== input.configVersion
      ) {
        await input.triggerRebuildHint("config-version-mismatch");
      }
      return projectionToPayload({
        projection: legacyRead.projection,
        rebuildState: "stale",
      });
    }

    await input.triggerRebuildHint("rollup-coverage-incomplete");
    if (input.configVersion && projection.selectedManifest.configVersion !== input.configVersion) {
      await input.triggerRebuildHint("config-version-mismatch");
    }
    return projectionToPayload({
      projection,
      rebuildState: "stale",
    });
  }

  if (
    projection.resolution.rebuildState !== "fresh" ||
    projection.prefix === LEGACY_PUBLIC_STATUS_REDIS_PREFIX
  ) {
    await input.triggerRebuildHint("stale-generation");
  }

  if (projection.prefix === LEGACY_PUBLIC_STATUS_REDIS_PREFIX) {
    await input.triggerRebuildHint("legacy-generation");
  }

  if (input.configVersion && projection.selectedManifest.configVersion !== input.configVersion) {
    await input.triggerRebuildHint("config-version-mismatch");
    return projectionToPayload({
      projection,
      rebuildState: "stale",
    });
  }

  return projectionToPayload({
    projection,
    rebuildState:
      projection.prefix === LEGACY_PUBLIC_STATUS_REDIS_PREFIX
        ? "stale"
        : projection.resolution.rebuildState,
  });
}
