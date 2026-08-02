import "server-only";

import type Redis from "ioredis";
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

type ResetRedis = Pick<Redis, "status" | "get" | "set" | "del"> & {
  eval(...args: [script: string, numkeys: number, ...keysAndArgs: string[]]): Promise<unknown>;
};

const LUA_COMPARE_DELETE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

function getReadyRedis(): ResetRedis {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true }) as ResetRedis | null;
  if (redis?.status !== "ready") {
    throw new Error("USER_STATISTICS_RESET_REDIS_UNAVAILABLE");
  }
  return redis;
}

export async function setUserStatisticsResetStatus(
  record: UserStatisticsResetStoredRecord
): Promise<void> {
  if (!(await statusStore.set(record.resetId, record))) {
    throw new Error("USER_STATISTICS_RESET_STATUS_WRITE_FAILED");
  }
}

export async function getUserStatisticsResetStatus(
  resetId: string
): Promise<UserStatisticsResetStoredRecord | null> {
  const raw = await getReadyRedis().get(`${RESET_STATUS_PREFIX}${resetId}`);
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
  await getReadyRedis().del(`${RESET_STATUS_PREFIX}${resetId}`);
}

export async function claimActiveUserStatisticsReset(
  userId: number,
  resetId: string
): Promise<{ acquired: boolean; resetId: string }> {
  const redis = getReadyRedis();
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
  const redis = getReadyRedis();
  await redis.eval(LUA_COMPARE_DELETE, 1, `${ACTIVE_RESET_PREFIX}${userId}`, resetId);
}
