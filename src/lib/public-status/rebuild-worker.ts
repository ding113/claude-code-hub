import { getRedisClient } from "@/lib/redis";
import { getConfiguredPublicStatusGroups, queryPublicStatusRequests } from "./aggregation";
import { publishCurrentPublicStatusConfigProjection } from "./config-publisher";
import { readCurrentInternalPublicStatusConfigSnapshot } from "./config-snapshot";
import {
  alignHourStartUtc,
  buildPublicStatusHourlyRollupsFromRequests,
  cleanupPublicStatusHourlyRollups,
  PUBLIC_STATUS_ROLLUP_RETENTION_DAYS,
  readPublicStatusHourlyRollups,
  upsertPublicStatusHourlyRollups,
  writeCurrentHourPublicStatusSummary,
} from "./hourly-rollups";
import {
  alignBucketStartUtc,
  buildGenerationFingerprint,
  buildPublicStatusManifestKey,
  buildPublicStatusRebuildLockKey,
} from "./redis-contract";

interface PublicStatusRebuildResult {
  sourceGeneration: string;
  skippedDueToDistributedLock?: boolean;
}

const inFlightRebuilds = new Map<string, Promise<PublicStatusRebuildResult>>();
const REBUILD_LOCK_TTL_MS = 60_000;
const RUNTIME_MANIFEST_TTL_SECONDS = 60 * 60 * 2;
const ROLLUP_QUERY_CHUNK_HOURS = 24;
const ROLLUP_RECENT_FINALIZED_HOURS = 2;
const ROLLUP_WRITE_BATCH_SIZE = 500;
const ROLLUP_HISTORY_HOURS = PUBLIC_STATUS_ROLLUP_RETENTION_DAYS * 24;

interface RedisHintWriter {
  get?(key: string): Promise<string | null> | string | null;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown> | unknown;
  set(key: string, value: string): Promise<unknown> | unknown;
  del?(...keys: string[]): Promise<unknown> | unknown;
  eval?(script: string, numKeys: number, ...args: string[]): Promise<unknown> | unknown;
  status?: string;
}

function getReadyRedisClient(redis?: RedisHintWriter | null): RedisHintWriter | null {
  const client = redis ?? getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!client || ("status" in client && client.status && client.status !== "ready")) {
    return null;
  }
  return client;
}

function parseConfigVersionOrder(configVersion: string): number {
  const digits = configVersion.replace(/\D+/g, "");
  return Number.parseInt(digits || "0", 10);
}

function shouldPromoteCurrentManifest(
  existing: { configVersion?: string; coveredTo?: string } | null,
  candidate: { configVersion: string; coveredTo: string }
): boolean {
  if (!existing) {
    return true;
  }

  const existingVersion = typeof existing.configVersion === "string" ? existing.configVersion : "";
  const candidateVersionOrder = parseConfigVersionOrder(candidate.configVersion);
  const existingVersionOrder = parseConfigVersionOrder(existingVersion);

  if (existingVersionOrder > candidateVersionOrder) {
    return false;
  }

  if (
    existingVersionOrder === candidateVersionOrder &&
    typeof existing.coveredTo === "string" &&
    Date.parse(existing.coveredTo) > Date.parse(candidate.coveredTo)
  ) {
    return false;
  }

  return true;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildHourlyStarts(input: { coveredFrom: string; coveredTo: string }): Date[] {
  const starts: Date[] = [];
  const coveredFromMs = alignHourStartUtc(input.coveredFrom).getTime();
  const coveredToMs = alignHourStartUtc(input.coveredTo).getTime();
  for (let cursorMs = coveredFromMs; cursorMs < coveredToMs; cursorMs += 60 * 60 * 1000) {
    starts.push(new Date(cursorMs));
  }
  return starts;
}

function buildRollupIdentity(input: {
  bucketStart: Date;
  publicGroupSlug: string;
  publicModelKey: string;
  requestTypeBadge: string;
}): string {
  return [
    input.bucketStart.toISOString(),
    input.publicGroupSlug,
    input.publicModelKey,
    input.requestTypeBadge,
  ].join("\u0000");
}

async function findHoursNeedingRollupRefresh(input: {
  configVersion: string;
  coveredFrom: Date;
  coveredTo: Date;
  groups: ReturnType<typeof getConfiguredPublicStatusGroups>;
  recentFinalizedHours?: number;
}): Promise<Date[]> {
  const allHourStarts = buildHourlyStarts({
    coveredFrom: input.coveredFrom.toISOString(),
    coveredTo: input.coveredTo.toISOString(),
  });
  if (allHourStarts.length === 0) {
    return [];
  }

  const existingRows = await readPublicStatusHourlyRollups({
    start: input.coveredFrom,
    end: input.coveredTo,
    configVersion: input.configVersion,
  });
  const existingKeys = new Set(
    existingRows.map((row) =>
      buildRollupIdentity({
        bucketStart: row.bucketStart,
        publicGroupSlug: row.publicGroupSlug,
        publicModelKey: row.publicModelKey,
        requestTypeBadge: row.requestTypeBadge,
      })
    )
  );
  const recentStartIndex = Math.max(
    0,
    allHourStarts.length - (input.recentFinalizedHours ?? ROLLUP_RECENT_FINALIZED_HOURS)
  );

  return allHourStarts.filter((hourStart, index) => {
    if (index >= recentStartIndex) {
      return true;
    }

    return input.groups.some((group) =>
      group.models.some(
        (model) =>
          !existingKeys.has(
            buildRollupIdentity({
              bucketStart: hourStart,
              publicGroupSlug: group.publicGroupSlug,
              publicModelKey: model.publicModelKey,
              requestTypeBadge: model.requestTypeBadge,
            })
          )
      )
    );
  });
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
}): Promise<void> {
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

  const manifestRecord = {
    configVersion: input.configVersion,
    intervalMinutes: input.intervalMinutes,
    rangeHours: input.rangeHours,
    generation: input.sourceGeneration,
    sourceGeneration: input.sourceGeneration,
    coveredFrom: input.coveredFrom,
    coveredTo: input.coveredTo,
    generatedAt: input.generatedAt,
    freshUntil: new Date(
      Date.parse(input.generatedAt) + input.intervalMinutes * 60 * 1000
    ).toISOString(),
    rebuildState: "idle" as const,
    lastCompleteGeneration: input.sourceGeneration,
  };

  await input.redis.set(
    versionedManifestKey,
    JSON.stringify(manifestRecord),
    "EX",
    RUNTIME_MANIFEST_TTL_SECONDS
  );
  if (typeof input.redis.get === "function") {
    let existingCurrentManifest: { configVersion?: string; coveredTo?: string } | null = null;
    try {
      const existingCurrentManifestRaw = await input.redis.get(currentManifestKey);
      existingCurrentManifest = existingCurrentManifestRaw
        ? (JSON.parse(existingCurrentManifestRaw) as { configVersion?: string; coveredTo?: string })
        : null;
    } catch {
      existingCurrentManifest = null;
    }

    if (shouldPromoteCurrentManifest(existingCurrentManifest, manifestRecord)) {
      await input.redis.set(
        currentManifestKey,
        JSON.stringify(manifestRecord),
        "EX",
        RUNTIME_MANIFEST_TTL_SECONDS
      );
    }
  } else {
    await input.redis.set(
      currentManifestKey,
      JSON.stringify(manifestRecord),
      "EX",
      RUNTIME_MANIFEST_TTL_SECONDS
    );
  }
}

async function acquireDistributedRebuildLock(input: {
  redis: RedisHintWriter & { get(key: string): Promise<string | null> | string | null };
  flightKey: string;
}): Promise<{ lockKey: string; lockId: string } | null> {
  const lockKey = buildPublicStatusRebuildLockKey(input.flightKey);
  const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await (
    input.redis as unknown as {
      set: (
        key: string,
        value: string,
        px: "PX",
        ttlMs: number,
        nx: "NX"
      ) => Promise<unknown> | unknown;
    }
  ).set(lockKey, lockId, "PX", REBUILD_LOCK_TTL_MS, "NX");

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
  if (typeof input.redis.eval === "function") {
    const luaScript = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      else
        return 0
      end
    `;
    await input.redis.eval(luaScript, 1, input.lockKey, input.lockId);
    return;
  }

  const current = await input.redis.get(input.lockKey);
  if (current === input.lockId && input.redis.del) {
    await input.redis.del(input.lockKey);
  }
}

export async function runPublicStatusRebuild(input: {
  flightKey: string;
  computeGeneration: () => Promise<PublicStatusRebuildResult>;
}): Promise<PublicStatusRebuildResult> {
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

  let configSnapshot = await readCurrentInternalPublicStatusConfigSnapshot({
    redis: redisReader,
  });
  if (!configSnapshot) {
    try {
      const publishResult = await publishCurrentPublicStatusConfigProjection({
        reason: "rebuild-bootstrap",
      });
      if (publishResult.written) {
        configSnapshot = await readCurrentInternalPublicStatusConfigSnapshot({
          redis: redisReader,
        });
      }
    } catch {
      // 忽略自举失败，让调用方继续沿用 missing-config 语义。
    }
  }
  if (!configSnapshot) {
    return { status: "disabled", reason: "missing-config" };
  }

  const groups = getConfiguredPublicStatusGroups(configSnapshot);
  if (groups.length === 0) {
    return { status: "disabled", reason: "no-configured-groups" };
  }

  const now = input.now ?? new Date();
  const coveredTo = alignBucketStartUtc(now.toISOString(), input.intervalMinutes);
  const currentHourStart = alignHourStartUtc(now);
  const manifestCoveredFrom = new Date(
    Date.parse(coveredTo) - input.rangeHours * 60 * 60 * 1000
  ).toISOString();
  const rollupCoveredFrom = new Date(
    currentHourStart.getTime() - ROLLUP_HISTORY_HOURS * 60 * 60 * 1000
  );
  const sourceGeneration = buildGenerationFingerprint({
    configVersion: configSnapshot.configVersion,
    intervalMinutes: input.intervalMinutes,
    coveredFromIso: manifestCoveredFrom,
    coveredToIso: coveredTo,
  });

  const flightKey = [
    configSnapshot.configVersion,
    `${input.intervalMinutes}m`,
    `${input.rangeHours}h`,
    sourceGeneration,
  ].join(":");

  const result = await runPublicStatusRebuild({
    flightKey,
    computeGeneration: async () => {
      const distributedLock = await acquireDistributedRebuildLock({
        redis: redisReader,
        flightKey,
      });
      if (!distributedLock) {
        return { sourceGeneration, skippedDueToDistributedLock: true };
      }

      try {
        const finalizedHourStarts = await findHoursNeedingRollupRefresh({
          configVersion: configSnapshot.configVersion,
          coveredFrom: rollupCoveredFrom,
          coveredTo: currentHourStart,
          groups,
        });
        for (const hourStartBatch of chunkArray(finalizedHourStarts, ROLLUP_QUERY_CHUNK_HOURS)) {
          const chunkStart = hourStartBatch[0];
          const chunkEndStart = hourStartBatch.at(-1);
          if (!chunkStart || !chunkEndStart) {
            continue;
          }

          const chunkEnd = new Date(chunkEndStart.getTime() + 60 * 60 * 1000);
          const requests = await queryPublicStatusRequests({
            groups,
            coveredFrom: chunkStart,
            coveredTo: chunkEnd,
          });
          const rollups = hourStartBatch.flatMap((hourStart) =>
            buildPublicStatusHourlyRollupsFromRequests({
              configVersion: configSnapshot.configVersion,
              hourStart,
              groups,
              requests,
            })
          );
          for (const rollupBatch of chunkArray(rollups, ROLLUP_WRITE_BATCH_SIZE)) {
            await upsertPublicStatusHourlyRollups(rollupBatch);
          }
        }

        const currentHourRequests = await queryPublicStatusRequests({
          groups,
          coveredFrom: currentHourStart,
          coveredTo: now,
        });
        const currentHourRollups = buildPublicStatusHourlyRollupsFromRequests({
          configVersion: configSnapshot.configVersion,
          hourStart: currentHourStart,
          groups,
          requests: currentHourRequests,
        });
        await writeCurrentHourPublicStatusSummary({
          redis,
          configVersion: configSnapshot.configVersion,
          hourStart: currentHourStart,
          rows: currentHourRollups,
        });
        await cleanupPublicStatusHourlyRollups({ now });

        await publishPublicStatusProjection({
          redis,
          configVersion: configSnapshot.configVersion,
          intervalMinutes: input.intervalMinutes,
          rangeHours: input.rangeHours,
          sourceGeneration,
          generatedAt: now.toISOString(),
          coveredFrom: manifestCoveredFrom,
          coveredTo,
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

  if (result.skippedDueToDistributedLock) {
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
