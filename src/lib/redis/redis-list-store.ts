import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";

type RedisListClient = Pick<Redis, "status" | "lrange" | "llen" | "expire" | "del"> & {
  eval(...args: [script: string, numkeys: number, ...rest: (string | number)[]]): Promise<unknown>;
};

/** RPUSH 全部值并（ttl>0 时）续期，单条脚本原子执行；返回追加后的列表长度。 */
const LUA_RPUSH_EXPIRE = `
local len = redis.call('RPUSH', KEYS[1], unpack(ARGV, 2))
if tonumber(ARGV[1]) > 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return len`;

export interface RedisListStoreOptions {
  prefix: string;
  redisClient?: RedisListClient | null;
}

function toLogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Redis LIST 封装（仿 RedisKVStore 的 null-guarded fail-open 约定）：
 * Redis 不可用或出错时返回 null/false，调用方按功能降级处理。
 *
 * 用于 Replay 响应块热层：owner 批量 RPUSH，attach 读者 LRANGE 跟尾。
 */
export class RedisListStore {
  private readonly prefix: string;
  private readonly injectedClient?: RedisListClient | null;

  constructor(options: RedisListStoreOptions) {
    this.prefix = options.prefix;
    this.injectedClient = options.redisClient;
  }

  private resolveRedisClient(): RedisListClient | null {
    if (this.injectedClient !== undefined) {
      return this.injectedClient;
    }
    return getRedisClient({ allowWhenRateLimitDisabled: true }) as RedisListClient | null;
  }

  private getReadyRedis(): RedisListClient | null {
    const redis = this.resolveRedisClient();
    if (redis?.status !== "ready") {
      return null;
    }
    return redis;
  }

  private buildKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * 批量追加并（可选）续期，单条 Lua 原子执行——追加成功即带 TTL，
   * 不存在「RPUSH 成功但 EXPIRE 失败留下永久 key」的窗口；失败返回 null。
   */
  async rpushBatch(key: string, values: string[], ttlSeconds?: number): Promise<number | null> {
    if (values.length === 0) return null;
    const redis = this.getReadyRedis();
    if (!redis) return null;
    const fullKey = this.buildKey(key);
    try {
      const ttl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : 0;
      const length = await redis.eval(LUA_RPUSH_EXPIRE, 1, fullKey, ttl, ...values);
      return typeof length === "number" ? length : Number(length);
    } catch (error) {
      logger.error("[RedisListStore] Failed to rpush", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return null;
    }
  }

  /** 从 start（0-based，含）读到末尾；失败返回 null（与空列表 [] 区分）。 */
  async lrangeFrom(key: string, start: number): Promise<string[] | null> {
    const redis = this.getReadyRedis();
    if (!redis) return null;
    try {
      return await redis.lrange(this.buildKey(key), start, -1);
    } catch (error) {
      logger.error("[RedisListStore] Failed to lrange", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return null;
    }
  }

  async llen(key: string): Promise<number | null> {
    const redis = this.getReadyRedis();
    if (!redis) return null;
    try {
      return await redis.llen(this.buildKey(key));
    } catch (error) {
      logger.error("[RedisListStore] Failed to llen", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return null;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const redis = this.getReadyRedis();
    if (!redis) return false;
    try {
      return (await redis.expire(this.buildKey(key), ttlSeconds)) === 1;
    } catch (error) {
      logger.error("[RedisListStore] Failed to expire", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    const redis = this.getReadyRedis();
    if (!redis) return false;
    try {
      return (await redis.del(this.buildKey(key))) > 0;
    } catch (error) {
      logger.error("[RedisListStore] Failed to delete", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return false;
    }
  }
}
