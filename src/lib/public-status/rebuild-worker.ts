import { getRedisClient } from "@/lib/redis";
import {
  buildPublicStatusPayloadFromRequests,
  getConfiguredPublicStatusGroups,
  queryPublicStatusRequests,
} from "./aggregation";
import { readCurrentInternalPublicStatusConfigSnapshot } from "./config-snapshot";
import {
  alignBucketStartUtc,
  buildGenerationFingerprint,
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
  buildPublicStatusRebuildHintKey,
  buildPublicStatusRebuildLockKey,
  buildPublicStatusSeriesChunkKey,
  buildPublicStatusTempKey,
} from "./redis-contract";

const inFlightRebuilds = new Map<string, Promise<{ sourceGeneration: string }>>();
const REBUILD_HINT_TTL_SECONDS = 60 * 5;
const REBUILD_LOCK_TTL_MS = 60_000;

interface RedisHintWriter {
  get?(key: string): Promise<string | null> | string | null;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> | unknown;
  set(key: string, value: string): Promise<unknown> | unknown;
  del?(...keys: string[]): Promise<unknown> | unknown;
  status?: string;
}

function getReadyRedisClient(redis?: RedisHintWriter | null): RedisHintWriter | null {
  const client = redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!client || ("status" in client && client.status && client.status !== "ready")) {
    return null;
  }
  return client;
}

async function publishPublicStatusProjection(input: {
  redis: RedisHintWriter;
  configVersion: string;
  intervalMinutes: number;
  rangeHours: number;
  sourceGeneration: string;
  generatedAt: string;
  coveredFrom: string;
  coveredTo: string;
  groups: unknown;
}): Promise<void> {
  const snapshotKey = buildPublicStatusCurrentSnapshotKey({
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    generation: input.sourceGeneration,
  });
  const seriesKey = buildPublicStatusSeriesChunkKey({
    intervalMinutes: input.intervalMinutes,
    generation: input.sourceGeneration,
    bucketStartIso: input.coveredFrom,
    bucketEndIso: input.coveredTo,
  });
  const currentManifestKey = buildPublicStatusManifestKey({
    configVersion: "current",
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });
  const versionedManifestKey = buildPublicStatusManifestKey({
    configVersion: input.configVersion,
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
  });

  const nonce = `${input.sourceGeneration}-${Date.now()}`;
  const snapshotTempKey = buildPublicStatusTempKey(snapshotKey, nonce);
  const seriesTempKey = buildPublicStatusTempKey(seriesKey, nonce);

  const snapshotRecord = {
    rebuildState: "fresh" as const,
    sourceGeneration: input.sourceGeneration,
    generatedAt: input.generatedAt,
    freshUntil: new Date(
      Date.parse(input.generatedAt) + input.intervalMinutes * 60 * 1000
    ).toISOString(),
    groups: input.groups,
  };
  const seriesRecord = {
    sourceGeneration: input.sourceGeneration,
    generatedAt: input.generatedAt,
    coveredFrom: input.coveredFrom,
    coveredTo: input.coveredTo,
    groups: input.groups,
  };
  const manifestRecord = {
    configVersion: input.configVersion,
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    generation: input.sourceGeneration,
    sourceGeneration: input.sourceGeneration,
    coveredFrom: input.coveredFrom,
    coveredTo: input.coveredTo,
    generatedAt: input.generatedAt,
    freshUntil: snapshotRecord.freshUntil,
    rebuildState: "idle" as const,
    lastCompleteGeneration: input.sourceGeneration,
  };

  await input.redis.set(snapshotTempKey, JSON.stringify(snapshotRecord));
  await input.redis.set(seriesTempKey, JSON.stringify(seriesRecord));
  await input.redis.set(snapshotKey, JSON.stringify(snapshotRecord));
  await input.redis.set(seriesKey, JSON.stringify(seriesRecord));
  await input.redis.set(versionedManifestKey, JSON.stringify(manifestRecord));
  await input.redis.set(currentManifestKey, JSON.stringify(manifestRecord));
  if (input.redis.del) {
    await input.redis.del(snapshotTempKey, seriesTempKey);
  }
}

async function acquireDistributedRebuildLock(input: {
  redis: RedisHintWriter & { get(key: string): Promise<string | null> | string | null };
  flightKey: string;
}): Promise<{ lockKey: string; lockId: string } | null> {
  const lockKey = buildPublicStatusRebuildLockKey(input.flightKey);
  const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await (input.redis as unknown as {
    set: (
      key: string,
      value: string,
      px: "PX",
      ttlMs: number,
      nx: "NX"
    ) => Promise<unknown> | unknown;
  }).set(lockKey, lockId, "PX", REBUILD_LOCK_TTL_MS, "NX");

  if (result !== "OK") {
    return null;
  }

  return { lockKey, lockId };
}

async function releaseDistributedRebuildLock(input: {
  redis: RedisHintWriter & { get(key: string): Promise<string | null> | string | null };
  lockKey: string;
  lockId: string;
}): Promise<void> {
  const current = await input.redis.get(input.lockKey);
  if (current === input.lockId && input.redis.del) {
    await input.redis.del(input.lockKey);
  }
}

export async function runPublicStatusRebuild(input: {
  flightKey: string;
  computeGeneration: () => Promise<{ sourceGeneration: string }>;
}): Promise<{ sourceGeneration: string }> {
  const existing = inFlightRebuilds.get(input.flightKey);
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve()
    .then(() => input.computeGeneration())
    .finally(() => {
      inFlightRebuilds.delete(input.flightKey);
    });

  inFlightRebuilds.set(input.flightKey, promise);
  return promise;
}

export async function rebuildPublicStatusProjection(input: {
  intervalMinutes: number;
  rangeHours: number;
  redis?: RedisHintWriter | null;
  now?: Date;
}): Promise<
  | { status: "disabled"; reason: "redis-unavailable" | "missing-config" | "no-configured-groups" }
  | { status: "skipped"; reason: "distributed-lock-held"; sourceGeneration: string }
  | { status: "updated"; sourceGeneration: string }
> {
  const redis = getReadyRedisClient(input.redis);
  if (!redis) {
    return { status: "disabled", reason: "redis-unavailable" };
  }
  if (typeof redis.get !== "function") {
    return { status: "disabled", reason: "redis-unavailable" };
  }
  const redisReader = redis as RedisHintWriter & {
    get(key: string): Promise<string | null> | string | null;
  };

  const configSnapshot = await readCurrentInternalPublicStatusConfigSnapshot({
    redis: redisReader,
  });
  if (!configSnapshot) {
    return { status: "disabled", reason: "missing-config" };
  }

  const groups = getConfiguredPublicStatusGroups(configSnapshot);
  if (groups.length === 0) {
    return { status: "disabled", reason: "no-configured-groups" };
  }

  const now = input.now ?? new Date();
  const coveredTo = alignBucketStartUtc(now.toISOString(), input.intervalMinutes);
  const coveredFrom = new Date(
    Date.parse(coveredTo) - input.rangeHours * 60 * 60 * 1000
  ).toISOString();
  const sourceGeneration = buildGenerationFingerprint({
    configVersion: configSnapshot.configVersion,
    intervalMinutes: input.intervalMinutes,
    coveredFromIso: coveredFrom,
    coveredToIso: coveredTo,
  });

  const flightKey = [
    configSnapshot.configVersion,
    `${input.intervalMinutes}m`,
    `${input.rangeHours}h`,
    sourceGeneration,
  ].join(":");

  let skippedDueToDistributedLock = false;
  const result = await runPublicStatusRebuild({
    flightKey,
    computeGeneration: async () => {
      const distributedLock = await acquireDistributedRebuildLock({
        redis: redisReader,
        flightKey,
      });
      if (!distributedLock) {
        skippedDueToDistributedLock = true;
        return { sourceGeneration };
      }

      try {
      const requests = await queryPublicStatusRequests({
        groups,
        coveredFrom: new Date(coveredFrom),
        coveredTo: new Date(coveredTo),
      });
      const aggregation = buildPublicStatusPayloadFromRequests({
        rangeHours: input.rangeHours,
        intervalMinutes: input.intervalMinutes,
        now: new Date(coveredTo),
        groups,
        requests,
      });

      await publishPublicStatusProjection({
        redis,
        configVersion: configSnapshot.configVersion,
        intervalMinutes: input.intervalMinutes,
        rangeHours: input.rangeHours,
        sourceGeneration,
        generatedAt: aggregation.generatedAt,
        coveredFrom: aggregation.coveredFrom,
        coveredTo: aggregation.coveredTo,
        groups: aggregation.groups,
      });

      return { sourceGeneration };
      } finally {
        await releaseDistributedRebuildLock({
          redis: redisReader,
          lockKey: distributedLock.lockKey,
          lockId: distributedLock.lockId,
        });
      }
    },
  });

  if (skippedDueToDistributedLock) {
    return {
      status: "skipped",
      reason: "distributed-lock-held",
      sourceGeneration: result.sourceGeneration,
    };
  }

  return {
    status: "updated",
    sourceGeneration: result.sourceGeneration,
  };
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

  if (typeof redis.get === "function") {
    const configSnapshot = await readCurrentInternalPublicStatusConfigSnapshot({
      redis: redis as RedisHintWriter & {
        get(key: string): Promise<string | null> | string | null;
      },
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
        await redis.set(
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
  }

  return {
    accepted: true,
    rebuildState: "rebuilding",
    key,
  };
}
