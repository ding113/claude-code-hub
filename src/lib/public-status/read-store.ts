import { getRedisClient } from "@/lib/redis";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
  resolvePublicStatusManifestState,
  type PublicStatusManifest,
} from "./redis-contract";
import type { PublicStatusPayload } from "./payload";

interface RedisReader {
  get(key: string): Promise<string | null> | string | null;
}

interface PublicStatusSnapshotRecord extends PublicStatusPayload {
  sourceGeneration: string;
  generatedAt: string;
  freshUntil: string;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as T;
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

export async function readPublicStatusPayload(input: {
  intervalMinutes: number;
  rangeHours: number;
  nowIso: string;
  configVersion?: string;
  redis?: RedisReader | null;
  triggerRebuildHint: (reason: string) => Promise<void> | void;
}): Promise<PublicStatusPayload> {
  const redis = input.redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis) {
    await input.triggerRebuildHint("redis-unavailable");
    return buildRebuildingPayload();
  }

  const manifestKey = buildPublicStatusManifestKey({
    configVersion: input.configVersion ?? "current",
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  const manifest = parseJson<PublicStatusManifest>(await redis.get(manifestKey));
  const resolution = resolvePublicStatusManifestState(manifest, input.nowIso);

  if (!resolution.sourceGeneration) {
    await input.triggerRebuildHint("manifest-missing");
    return buildRebuildingPayload();
  }

  const snapshotKey = buildPublicStatusCurrentSnapshotKey({
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    generation: resolution.sourceGeneration,
  });
  const snapshot = parseJson<PublicStatusSnapshotRecord>(await redis.get(snapshotKey));
  if (!snapshot) {
    await input.triggerRebuildHint("snapshot-missing");
    return buildRebuildingPayload();
  }

  if (resolution.rebuildState !== "fresh") {
    await input.triggerRebuildHint("stale-generation");
  }

  return {
    rebuildState: resolution.rebuildState,
    sourceGeneration: snapshot.sourceGeneration,
    generatedAt: snapshot.generatedAt,
    freshUntil: snapshot.freshUntil,
    groups: snapshot.groups ?? [],
  };
}
