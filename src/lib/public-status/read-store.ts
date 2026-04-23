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

  const manifestKey = buildPublicStatusManifestKey({
    configVersion: input.configVersion ?? "current",
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  const manifest = parseJson<PublicStatusManifest>(await safeGet(redis, manifestKey));
  const currentManifestKey = buildPublicStatusManifestKey({
    configVersion: "current",
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  const currentManifest = parseJson<PublicStatusManifest>(await safeGet(redis, currentManifestKey));

  let selectedManifest = manifest;
  let resolution = resolvePublicStatusManifestState(selectedManifest, input.nowIso);

  if (!resolution.sourceGeneration && currentManifest) {
    selectedManifest = currentManifest;
    resolution = {
      ...resolvePublicStatusManifestState(currentManifest, input.nowIso),
      rebuildState: "stale",
    };
  }

  if (!resolution.sourceGeneration) {
    await input.triggerRebuildHint("manifest-missing");
    return buildRebuildingPayload();
  }

  const snapshotKey = buildPublicStatusCurrentSnapshotKey({
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    generation: resolution.sourceGeneration,
  });
  const snapshot = parseJson<PublicStatusSnapshotRecord>(await safeGet(redis, snapshotKey));

  if (!snapshot) {
    await input.triggerRebuildHint("snapshot-missing");
    return buildRebuildingPayload();
  }

  if (resolution.rebuildState !== "fresh") {
    await input.triggerRebuildHint("stale-generation");
  }

  if (input.configVersion && selectedManifest?.configVersion !== input.configVersion) {
    await input.triggerRebuildHint("config-version-mismatch");
    resolution = {
      ...resolution,
      rebuildState: "stale",
    };
  }

  return {
    rebuildState: resolution.rebuildState,
    sourceGeneration: snapshot.sourceGeneration,
    generatedAt: snapshot.generatedAt,
    freshUntil: snapshot.freshUntil,
    groups: sanitizeGroupSnapshots(snapshot.groups),
  };
}
