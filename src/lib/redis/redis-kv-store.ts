import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

type RedisKVClient = Pick<Redis, "status" | "setex" | "get" | "del"> & {
  // Redis EVAL for Lua scripts (atomic getAndDelete)
  eval(...args: [script: string, numkeys: number, ...keys: string[]]): Promise<unknown>;
};

export interface RedisKVStoreOptions {
  prefix: string;
  defaultTtlSeconds: number;
  redisClient?: RedisKVClient | null;
}

function toLogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Atomic GET + DEL via Lua script -- prevents TOCTOU race where two concurrent
// callers both GET the same single-use token before either DELetes it.
const LUA_GET_AND_DEL = `
local val = redis.call('GET', KEYS[1])
if val then redis.call('DEL', KEYS[1]) end
return val`;

export class RedisKVStore<T> {
  private readonly prefix: string;
  private readonly defaultTtlSeconds: number;
  private readonly injectedClient?: RedisKVClient | null;

  constructor(options: RedisKVStoreOptions) {
    this.prefix = options.prefix;
    this.defaultTtlSeconds = options.defaultTtlSeconds;
    this.injectedClient = options.redisClient;
  }

  private resolveRedisClient(): RedisKVClient | null {
    if (this.injectedClient !== undefined) {
      return this.injectedClient;
    }
    return getRedisClient({ allowWhenRateLimitDisabled: true }) as RedisKVClient | null;
  }

  private getReadyRedis(): RedisKVClient | null {
    const redis = this.resolveRedisClient();
    if (!redis || redis.status !== "ready") {
      return null;
    }
    return redis;
  }

  private buildKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const redis = this.getReadyRedis();
    if (!redis) {
      return false;
    }

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    try {
      await redis.setex(this.buildKey(key), ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error("[RedisKVStore] Failed to set", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return false;
    }
  }

  async get(key: string): Promise<T | null> {
    const redis = this.getReadyRedis();
    if (!redis) {
      return null;
    }

    try {
      const raw = await redis.get(this.buildKey(key));
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error("[RedisKVStore] Failed to get", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return null;
    }
  }

  async getAndDelete(key: string): Promise<T | null> {
    const redis = this.getReadyRedis();
    if (!redis) {
      return null;
    }

    const fullKey = this.buildKey(key);
    try {
      const raw = (await redis.eval(LUA_GET_AND_DEL, 1, fullKey)) as string | null;
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error("[RedisKVStore] Failed to getAndDelete", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    const redis = this.getReadyRedis();
    if (!redis) {
      return false;
    }

    try {
      const deleted = await redis.del(this.buildKey(key));
      return deleted > 0;
    } catch (error) {
      logger.error("[RedisKVStore] Failed to delete", {
        error: toLogError(error),
        prefix: this.prefix,
        key,
      });
      return false;
    }
  }
}
