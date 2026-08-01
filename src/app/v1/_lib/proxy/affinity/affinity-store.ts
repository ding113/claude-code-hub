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
 *   活跃绑定  "1|<providerId>|<generation>"
 *   墓碑      "0|<reason>|<generation>"（failover 后短 TTL 防羊群，查找时跳过继续向浅——
 *              修复 CCHP 已知缺陷：最深命中为 disabled 时直接判 miss）
 *
 * 查找：单次 Lua 往返，KEYS 按最深->最浅传入，首个活跃值即最长前缀命中，
 * 命中时 EXPIRE 滑动续期（对齐 prompt cache 的「读即续」语义）。
 *
 * 路由路径上的 Redis 失败 fail-open：lookup 返回 null（回落加权随机），写操作静默放弃。
 * 管理终止使用 invalidate 的 boolean 结果区分命令成功与 Redis 故障。
 */

const LOOKUP_LONGEST_PREFIX_LUA = `
-- affinity_lookup_v2
local ttl = tonumber(ARGV[1])
local generationKey = KEYS[#KEYS]
local generation = redis.call('GET', generationKey)
if not generation then
  redis.call('SET', generationKey, '0', 'NX')
  generation = redis.call('GET', generationKey)
end
for i = 1, #KEYS - 1 do
  local v = redis.call('GET', KEYS[i])
  if v and string.sub(v, 1, 2) == '1|' then
    local bindingGeneration = string.match(v, '^1|[^|]+|([^|]+)$') or '0'
    if bindingGeneration == generation then
      if ttl and ttl > 0 then
        redis.call('EXPIRE', KEYS[i], ttl)
      end
      return {i, v, generation}
    end
  end
end
return {0, '', generation}
`;

const CAS_WRITE_LUA = `
-- affinity_cas_write_v1
local generation = redis.call('GET', KEYS[1])
if not generation or generation ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

const INVALIDATE_LUA = `
-- affinity_invalidate_v1
local generation = redis.call('INCR', KEYS[1])
if #KEYS > 1 then
  local bindings = {}
  for i = 2, #KEYS do
    bindings[#bindings + 1] = KEYS[i]
  end
  redis.call('DEL', unpack(bindings))
end
return generation
`;

const TOMBSTONE_TTL_SECONDS = 60;

export interface AffinityHint {
  providerId: number;
  matchedFp: string;
  /** 0-based：0 = 最深（tip），越大越浅；仅用于观测 */
  matchedIndex: number;
}

export interface AffinityLookupResult {
  hint: AffinityHint | null;
  generation: string;
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

  private buildGenerationKey(scopeTag: string): string {
    return `cch:pfx:{${scopeTag}}:generation`;
  }

  /**
   * 最长前缀查找。fpsDeepestFirst 为最深->最浅的会话消息边界指纹序列
   * （不含 F_sys：仅系统提示词相同不构成前缀命中）。
   * 命中活跃绑定即返回并滑动续期；墓碑被 Lua 跳过继续向浅。
   */
  async lookup(
    scopeTag: string,
    fpsDeepestFirst: string[],
    slidingTtlSeconds: number
  ): Promise<AffinityLookupResult | null> {
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
        keys.length + 1,
        ...keys,
        this.buildGenerationKey(scopeTag),
        String(Math.max(0, Math.floor(slidingTtlSeconds)))
      )) as [number, string, string] | null;

      if (!result || !Array.isArray(result) || result.length < 3) return null;
      const [index, value, generation] = result;
      if (!generation) return null;
      const matchedIndex = Number(index) - 1;
      if (matchedIndex < 0) {
        return { hint: null, generation: String(generation) };
      }
      const providerId = Number.parseInt(String(value).slice(2), 10);
      if (!Number.isFinite(providerId) || providerId <= 0) {
        return { hint: null, generation: String(generation) };
      }

      return {
        generation: String(generation),
        hint: {
          providerId,
          matchedIndex,
          matchedFp: fpsDeepestFirst[matchedIndex] ?? "",
        },
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
   * 成功终态写回：只写 tip 一键（对话推进天然累积链条，无需写全窗口）。
   * 不写 F_sys 键：仅系统提示词相同的跨对话请求不应互相粘连。
   * 仅 owner 成功请求调用；replay serve / 竞速败者 / 失败重试不写。
   */
  async put(
    scopeTag: string,
    tipFp: string,
    providerId: number,
    ttlSeconds: number,
    expectedGeneration: string | null | undefined
  ): Promise<boolean> {
    if (!scopeTag || !tipFp || providerId <= 0 || ttlSeconds <= 0 || !expectedGeneration) {
      return false;
    }
    const redis = this.getReadyRedis();
    if (!redis) return false;

    const value = `1|${providerId}|${expectedGeneration}`;
    try {
      const result = await redis.eval(
        CAS_WRITE_LUA,
        2,
        this.buildGenerationKey(scopeTag),
        this.buildKey(scopeTag, tipFp),
        expectedGeneration,
        value,
        ttlSeconds
      );
      return Number(result) === 1;
    } catch (error) {
      logger.warn("[AffinityStore] put failed", {
        error: error instanceof Error ? error.message : String(error),
        scopeTag,
        providerId,
      });
      return false;
    }
  }

  /** failover 墓碑：短 TTL 覆盖，阻止旧绑定立即复活，同时允许查找向浅回落。 */
  async tombstone(
    scopeTag: string,
    fp: string,
    reason: string,
    expectedGeneration: string | null | undefined
  ): Promise<boolean> {
    if (!scopeTag || !fp || !expectedGeneration) return false;
    const redis = this.getReadyRedis();
    if (!redis) return false;
    try {
      const result = await redis.eval(
        CAS_WRITE_LUA,
        2,
        this.buildGenerationKey(scopeTag),
        this.buildKey(scopeTag, fp),
        expectedGeneration,
        `0|${reason.slice(0, 32)}|${expectedGeneration}`,
        TOMBSTONE_TTL_SECONDS
      );
      return Number(result) === 1;
    } catch (error) {
      logger.warn("[AffinityStore] tombstone failed", {
        error: error instanceof Error ? error.message : String(error),
        scopeTag,
      });
      return false;
    }
  }

  /**
   * 管理员终止前缀 Session 时原子递增 scope generation，再删除目标及已知祖先。
   * 未知 descendant 与在途旧请求仍携带旧 generation，后续 lookup/CAS write 均会忽略。
   */
  async invalidate(scopeTag: string, fingerprints: string[]): Promise<boolean> {
    if (!scopeTag || fingerprints.length === 0) return false;
    const redis = this.getReadyRedis();
    if (!redis) return false;

    const keys = [...new Set(fingerprints.filter(Boolean))].map((fp) =>
      this.buildKey(scopeTag, fp)
    );
    if (keys.length === 0) return false;

    try {
      await redis.eval(INVALIDATE_LUA, keys.length + 1, this.buildGenerationKey(scopeTag), ...keys);
      return true;
    } catch (error) {
      logger.warn("[AffinityStore] invalidate failed", {
        error: error instanceof Error ? error.message : String(error),
        scopeTag,
      });
      return false;
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
