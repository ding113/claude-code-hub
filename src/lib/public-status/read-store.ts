import { getRedisClient } from "@/lib/redis";
import type { PublicStatusPayload } from "./payload";
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

interface PublicStatusSnapshotRecord extends PublicStatusPayload {
  sourceGeneration: string;
  generatedAt: string;
  freshUntil: string;
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
    groups: snapshot.groups ?? [],
  };
}
