import { getRedisClient } from "@/lib/redis";
import { readCurrentInternalPublicStatusConfigSnapshot } from "./config-snapshot";
import { buildPublicStatusManifestKey, buildPublicStatusRebuildHintKey } from "./redis-contract";

const REBUILD_HINT_TTL_SECONDS = 60 * 5;

interface RedisHintWriter {
  get(key: string): Promise<string | null> | string | null;
  pttl?(key: string): Promise<number> | number;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> | unknown;
  set(key: string, value: string, mode: "PX", milliseconds: number): Promise<unknown> | unknown;
  set(key: string, value: string): Promise<unknown> | unknown;
  status?: string;
}

async function writeManifestPreservingTtl(
  redis: RedisHintWriter,
  key: string,
  value: string
): Promise<void> {
  const ttlMs = typeof redis.pttl === "function" ? Number(await redis.pttl(key)) : Number.NaN;

  if (Number.isFinite(ttlMs) && ttlMs > 0) {
    await redis.set(key, value, "PX", ttlMs);
    return;
  }

  await redis.set(key, value);
}

function getReadyRedisClient(redis?: RedisHintWriter | null): RedisHintWriter | null {
  const client = redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!client || ("status" in client && client.status && client.status !== "ready")) {
    return null;
  }
  return client;
}

export async function schedulePublicStatusRebuild(input: {
  intervalMinutes: number;
  rangeHours: number;
  reason: string;
  redis?: RedisHintWriter | null;
}): Promise<{
  accepted: boolean;
  rebuildState: string;
  key?: string;
}> {
  const redis = getReadyRedisClient(input.redis);
  if (!redis) {
    return {
      accepted: false,
      rebuildState: "rebuilding",
    };
  }

  const key = buildPublicStatusRebuildHintKey({
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  await redis.set(
    key,
    JSON.stringify({
      reason: input.reason,
      requestedAt: new Date().toISOString(),
      intervalMinutes: input.intervalMinutes,
      rangeHours: input.rangeHours,
    }),
    "EX",
    REBUILD_HINT_TTL_SECONDS
  );

  const configSnapshot = await readCurrentInternalPublicStatusConfigSnapshot({
    redis,
  });
  const versionedManifestKey = buildPublicStatusManifestKey({
    configVersion: configSnapshot?.configVersion ?? "current",
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  const currentManifestKey = buildPublicStatusManifestKey({
    configVersion: "current",
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });

  for (const manifestKey of [versionedManifestKey, currentManifestKey]) {
    const manifestRaw = await redis.get(manifestKey);
    if (!manifestRaw) {
      continue;
    }

    try {
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      await writeManifestPreservingTtl(
        redis,
        manifestKey,
        JSON.stringify({
          ...manifest,
          rebuildState: "rebuilding",
        })
      );
    } catch {
      // 忽略坏 manifest；读侧会走安全降级。
    }
  }

  return {
    accepted: true,
    rebuildState: "rebuilding",
    key,
  };
}
