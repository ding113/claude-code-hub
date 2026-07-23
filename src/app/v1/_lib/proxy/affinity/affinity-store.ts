import "server-only";

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";

/**
 * 前缀亲和绑定存储（CCHP storage/dragonfly/affinity_store.go 的移植与改进）。
 *
 * 键格式：cch:pfx:{<scopeTag>}:fp:<fp>
 * （{scopeTag} 为 Redis Cluster hash-tag：同 scope 的所有 fp 键落同一 slot，
 *   多键 Lua 在集群下无 CROSSSLOT；单机 Redis 下花括号只是键名的一部分，无副作用。）
 *
 * 值格式（管道串，避免 JSON 编解码开销）：
 *   活跃绑定  "1|<providerId>"
 *   墓碑      "0|<reason>"（failover 后短 TTL 防羊群，查找时跳过继续向浅——
 *              修复 CCHP 已知缺陷：最深命中为 disabled 时直接判 miss）
 *
 * 查找：单次 Lua 往返，KEYS 按最深->最浅传入，首个活跃值即最长前缀命中，
 * 命中时 EXPIRE 滑动续期（对齐 prompt cache 的「读即续」语义）。
 *
 * 一切 Redis 失败 fail-open：lookup 返回 null（回落加权随机），写操作静默放弃。
 */

const LOOKUP_LONGEST_PREFIX_LUA = `
local ttl = tonumber(ARGV[1])
for i = 1, #KEYS do
  local v = redis.call('GET', KEYS[i])
  if v and string.sub(v, 1, 2) == '1|' then
    if ttl and ttl > 0 then
      redis.call('EXPIRE', KEYS[i], ttl)
    end
    return {i, v}
  end
end
return nil
`;

const TOMBSTONE_TTL_SECONDS = 60;

export interface AffinityHint {
  providerId: number;
  /** 命中的边界在传入序列中的位置换算出的深度语义 */
  tier: "conversation" | "system";
  matchedFp: string;
  /** 0-based：0 = 最深（tip），越大越浅；仅用于观测 */
  matchedIndex: number;
}

type RedisLuaClient = Pick<Redis, "status" | "set" | "del"> & {
  eval(...args: [script: string, numkeys: number, ...rest: (string | number)[]]): Promise<unknown>;
};

export interface AffinityStoreOptions {
  redisClient?: RedisLuaClient | null;
}

export class AffinityStore {
  private readonly injectedClient?: RedisLuaClient | null;

  constructor(options: AffinityStoreOptions = {}) {
    this.injectedClient = options.redisClient;
  }

  private getReadyRedis(): RedisLuaClient | null {
    const redis =
      this.injectedClient !== undefined
        ? this.injectedClient
        : (getRedisClient({ allowWhenRateLimitDisabled: true }) as RedisLuaClient | null);
    if (redis?.status !== "ready") return null;
    return redis;
  }

  private buildKey(scopeTag: string, fp: string): string {
    return `cch:pfx:{${scopeTag}}:fp:${fp}`;
  }

  /**
   * 最长前缀查找。fpsDeepestFirst 为最深->最浅指纹序列（最后一个是 F_sys）。
   * 命中活跃绑定即返回并滑动续期；墓碑被 Lua 跳过继续向浅。
   */
  async lookup(
    scopeTag: string,
    fpsDeepestFirst: string[],
    slidingTtlSeconds: number
  ): Promise<AffinityHint | null> {
    if (!scopeTag || fpsDeepestFirst.length === 0) return null;
    const redis = this.getReadyRedis();
    if (!redis) return null;

    const keys = fpsDeepestFirst
      .filter((fp) => fp.length > 0)
      .map((fp) => this.buildKey(scopeTag, fp));
    if (keys.length === 0) return null;

    try {
      const result = (await redis.eval(
        LOOKUP_LONGEST_PREFIX_LUA,
        keys.length,
        ...keys,
        String(Math.max(0, Math.floor(slidingTtlSeconds)))
      )) as [number, string] | null;

      if (!result || !Array.isArray(result) || result.length < 2) return null;
      const [index, value] = result;
      const providerId = Number.parseInt(String(value).slice(2), 10);
      if (!Number.isFinite(providerId) || providerId <= 0) return null;

      const matchedIndex = Number(index) - 1;
      return {
        providerId,
        matchedIndex,
        matchedFp: fpsDeepestFirst[matchedIndex] ?? "",
        // 最后一个键是 F_sys：仅系统提示词命中
        tier: matchedIndex >= fpsDeepestFirst.length - 1 ? "system" : "conversation",
      };
    } catch (error) {
      logger.warn("[AffinityStore] lookup failed, falling back to no-affinity", {
        error: error instanceof Error ? error.message : String(error),
        scopeTag,
      });
      return null;
    }
  }

  /**
   * 成功终态写回：只写 tip + sys 两键（对话推进天然累积链条，无需写全窗口）。
   * 仅 owner 成功请求调用；replay serve / 竞速败者 / 失败重试不写。
   */
  async put(
    scopeTag: string,
    tipFp: string,
    sysFp: string,
    providerId: number,
    ttlSeconds: number
  ): Promise<void> {
    if (!scopeTag || !tipFp || providerId <= 0 || ttlSeconds <= 0) return;
    const redis = this.getReadyRedis();
    if (!redis) return;

    const value = `1|${providerId}`;
    try {
      await redis.set(this.buildKey(scopeTag, tipFp), value, "EX", ttlSeconds);
      if (sysFp && sysFp !== tipFp) {
        await redis.set(this.buildKey(scopeTag, sysFp), value, "EX", ttlSeconds);
      }
    } catch (error) {
      logger.warn("[AffinityStore] put failed", {
        error: error instanceof Error ? error.message : String(error),
        scopeTag,
        providerId,
      });
    }
  }

  /** failover 墓碑：短 TTL 覆盖，阻止旧绑定立即复活，同时允许查找向浅回落。 */
  async tombstone(scopeTag: string, fp: string, reason: string): Promise<void> {
    if (!scopeTag || !fp) return;
    const redis = this.getReadyRedis();
    if (!redis) return;
    try {
      await redis.set(
        this.buildKey(scopeTag, fp),
        `0|${reason.slice(0, 32)}`,
        "EX",
        TOMBSTONE_TTL_SECONDS
      );
    } catch (error) {
      logger.warn("[AffinityStore] tombstone failed", {
        error: error instanceof Error ? error.message : String(error),
        scopeTag,
      });
    }
  }
}

let sharedStore: AffinityStore | null = null;

export function getAffinityStore(): AffinityStore {
  if (!sharedStore) {
    sharedStore = new AffinityStore();
  }
  return sharedStore;
}
