import "server-only";

import type Redis from "ioredis";
import { getEnvConfig } from "@/lib/config/env.schema";
import { getRedisClient } from "@/lib/redis/client";
import { RedisKVStore } from "@/lib/redis/redis-kv-store";
import type { UserStatisticsResetStoredRecord } from "./types";

const RESET_STATUS_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACTIVE_RESET_PREFIX = "cch:user-statistics-reset:active:";
const RESET_STATUS_PREFIX = "cch:user-statistics-reset:status:";
const statusStore = new RedisKVStore<UserStatisticsResetStoredRecord>({
  prefix: RESET_STATUS_PREFIX,
  defaultTtlSeconds: RESET_STATUS_TTL_SECONDS,
});

type ResetRedis = Pick<Redis, "status" | "get" | "set" | "del" | "once" | "removeListener"> & {
  eval(...args: [script: string, numkeys: number, ...keysAndArgs: string[]]): Promise<unknown>;
};

const LUA_COMPARE_DELETE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

async function getReadyRedis(): Promise<ResetRedis> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true }) as ResetRedis | null;
  if (!redis || redis.status === "end") {
    throw new Error("USER_STATISTICS_RESET_REDIS_UNAVAILABLE");
  }
  if (redis.status === "ready") return redis;

  return new Promise<ResetRedis>((resolve, reject) => {
    let settled = false;
    const finish = (result: { redis: ResetRedis } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      redis.removeListener("ready", onReady);
      redis.removeListener("end", onEnd);
      if ("redis" in result) resolve(result.redis);
      else reject(result.error);
    };
    const onReady = () => finish({ redis });
    const onEnd = () => finish({ error: new Error("USER_STATISTICS_RESET_REDIS_UNAVAILABLE") });
    const timeoutId = setTimeout(onEnd, getEnvConfig().REDIS_COMMAND_TIMEOUT_MS);

    redis.once("ready", onReady);
    redis.once("end", onEnd);
    if (redis.status === "ready") onReady();
    else if (redis.status === "end") onEnd();
  });
}

export async function setUserStatisticsResetStatus(
  record: UserStatisticsResetStoredRecord
): Promise<void> {
  await getReadyRedis();
  if (!(await statusStore.set(record.resetId, record))) {
    throw new Error("USER_STATISTICS_RESET_STATUS_WRITE_FAILED");
  }
}

export async function getUserStatisticsResetStatus(
  resetId: string
): Promise<UserStatisticsResetStoredRecord | null> {
  const redis = await getReadyRedis();
  const raw = await redis.get(`${RESET_STATUS_PREFIX}${resetId}`);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as UserStatisticsResetStoredRecord;
    return {
      ...record,
      fixed5hKeyIds: record.fixed5hKeyIds ?? [],
      fixed5hPreparationVersion: record.fixed5hPreparationVersion === 1 ? 1 : null,
    };
  } catch {
    throw new Error("USER_STATISTICS_RESET_STATUS_INVALID");
  }
}

export async function deleteUserStatisticsResetStatus(resetId: string): Promise<void> {
  const redis = await getReadyRedis();
  await redis.del(`${RESET_STATUS_PREFIX}${resetId}`);
}

export async function claimActiveUserStatisticsReset(
  userId: number,
  resetId: string
): Promise<{ acquired: boolean; resetId: string }> {
  const redis = await getReadyRedis();
  const key = `${ACTIVE_RESET_PREFIX}${userId}`;
  const result = await redis.set(key, resetId, "EX", RESET_STATUS_TTL_SECONDS, "NX");
  if (result === "OK") {
    return { acquired: true, resetId };
  }

  const existing = await redis.get(key);
  if (!existing) {
    throw new Error("USER_STATISTICS_RESET_ACTIVE_CLAIM_FAILED");
  }
  return { acquired: false, resetId: existing };
}

export async function releaseActiveUserStatisticsReset(
  userId: number,
  resetId: string
): Promise<void> {
  const redis = await getReadyRedis();
  await redis.eval(LUA_COMPARE_DELETE, 1, `${ACTIVE_RESET_PREFIX}${userId}`, resetId);
}
