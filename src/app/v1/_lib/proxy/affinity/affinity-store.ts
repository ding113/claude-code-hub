import "server-only";

import { randomUUID } from "node:crypto";
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
 *   活跃绑定  "1|<providerId>|<identityFp>|<generation>"
 *   墓碑      "0|<reason>|<identityFp>|<generation>"（failover 后短 TTL 防羊群，查找时跳过继续向浅——
 *              修复 CCHP 已知缺陷：最深命中为 disabled 时直接判 miss）
 *
 * 查找：先按最深->最浅读取候选，再用显式声明的 binding/generation/registry KEYS
 * 原子校验首个有效候选；命中时 EXPIRE 滑动续期（对齐 prompt cache 的「读即续」语义）。
 *
 * 路由路径上的 Redis 失败 fail-open：lookup 返回 null（回落加权随机），写操作静默放弃。
 * 管理终止使用 invalidate 的 boolean 结果区分命令成功与 Redis 故障。
 */

const LOOKUP_CANDIDATES_LUA = `
-- affinity_lookup_candidates_v4
local legacyGeneration = redis.call('GET', KEYS[#KEYS]) or '0'
local candidates = {}

for i = 1, #KEYS - 1 do
  local v = redis.call('GET', KEYS[i])
  if v and string.sub(v, 1, 2) == '1|' then
    local fourPartProvider = string.match(v, '^1|([^|]+)|([^|]+)|([^|]+)$')
    local threePartProvider, threePartGeneration = string.match(v, '^1|([^|]+)|([^|]+)$')
    local twoPartProvider = string.match(v, '^1|([^|]+)$')
    if fourPartProvider or twoPartProvider or
       (threePartProvider and threePartGeneration == legacyGeneration) then
      candidates[#candidates + 1] = i
      candidates[#candidates + 1] = v
    end
  end
end
return candidates
`;

const VALIDATE_LOOKUP_HIT_LUA = `
-- affinity_validate_hit_v4
local expectedValue = ARGV[1]
local expectedGeneration = ARGV[2]
local migratedValue = ARGV[3]
local ttl = tonumber(ARGV[4])
local generationTtl = tonumber(ARGV[5])

local function extendTtl(key, requestedTtl)
  if not requestedTtl or requestedTtl <= 0 then return end
  local currentTtl = redis.call('TTL', key)
  if currentTtl < requestedTtl then
    redis.call('EXPIRE', key, requestedTtl)
  end
end

if redis.call('GET', KEYS[1]) ~= expectedValue then
  return 0
end
redis.call('SET', KEYS[2], expectedGeneration, 'EX', generationTtl, 'NX')
if redis.call('GET', KEYS[2]) ~= expectedGeneration then
  return 0
end
if migratedValue ~= '' then
  redis.call('SET', KEYS[1], migratedValue, 'KEEPTTL')
end
if ttl and ttl > 0 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
extendTtl(KEYS[2], generationTtl)
redis.call('SADD', KEYS[3], KEYS[1])
extendTtl(KEYS[3], ttl)
return 1
`;

const ENSURE_GENERATION_LUA = `
-- affinity_ensure_generation_v4
local candidateGeneration = ARGV[1]
local generationTtl = tonumber(ARGV[2])
redis.call('SET', KEYS[1], candidateGeneration, 'EX', generationTtl, 'NX')
local currentTtl = redis.call('TTL', KEYS[1])
if currentTtl < generationTtl then
  redis.call('EXPIRE', KEYS[1], generationTtl)
end
return redis.call('GET', KEYS[1])
`;

const CAS_WRITE_LUA = `
-- affinity_cas_write_v2
local generation = redis.call('GET', KEYS[1])
if not generation or generation ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
redis.call('SADD', KEYS[3], KEYS[2])
local registryTtl = redis.call('TTL', KEYS[3])
if registryTtl < tonumber(ARGV[3]) then
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[3]))
end
local generationTtl = redis.call('TTL', KEYS[1])
if generationTtl < tonumber(ARGV[4]) then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
end
return 1
`;

const INVALIDATE_LUA = `
-- affinity_invalidate_v2
local generation = ARGV[1]
redis.call('SET', KEYS[1], generation, 'EX', tonumber(ARGV[2]))
for i = 3, #KEYS do
  redis.call('DEL', KEYS[i])
end
redis.call('DEL', KEYS[2])
return generation
`;

const TOMBSTONE_TTL_SECONDS = 60;
const GENERATION_FENCE_TTL_SECONDS = 2 * 24 * 60 * 60;

export interface AffinityHint {
  providerId: number;
  matchedFp: string;
  /** 0-based：0 = 最深（tip），越大越浅；仅用于观测 */
  matchedIndex: number;
}

export interface AffinityLookupResult {
  hint: AffinityHint | null;
  identityFp: string;
  generation: string;
}

type RedisLuaClient = Pick<Redis, "status" | "set" | "del" | "smembers"> & {
  eval(...args: [script: string, numkeys: number, ...rest: (string | number)[]]): Promise<unknown>;
};

export interface AffinityStoreOptions {
  redisClient?: RedisLuaClient | null;
  generationToken?: () => string;
}

export class AffinityStore {
  private readonly injectedClient?: RedisLuaClient | null;
  private readonly generationToken: () => string;

  constructor(options: AffinityStoreOptions = {}) {
    this.injectedClient = options.redisClient;
    this.generationToken = options.generationToken ?? (() => `v3:${randomUUID()}`);
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

  private buildGenerationKey(scopeTag: string, identityFp: string): string {
    return `cch:pfx:{${scopeTag}}:gen:${identityFp}`;
  }

  private buildDescendantsKey(scopeTag: string, identityFp: string): string {
    return `cch:pfx:{${scopeTag}}:desc:${identityFp}`;
  }

  private buildLegacyGenerationKey(scopeTag: string): string {
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

    const fingerprints = fpsDeepestFirst.filter((fp) => fp.length > 0);
    const keys = fingerprints.map((fp) => this.buildKey(scopeTag, fp));
    const missIdentityFp = fingerprints[0];
    if (keys.length === 0 || !missIdentityFp) return null;

    try {
      const candidates = (await redis.eval(
        LOOKUP_CANDIDATES_LUA,
        keys.length + 1,
        ...keys,
        this.buildLegacyGenerationKey(scopeTag)
      )) as unknown;

      if (!Array.isArray(candidates)) return null;
      for (let offset = 0; offset + 1 < candidates.length; offset += 2) {
        const matchedIndex = Number(candidates[offset]) - 1;
        const value = String(candidates[offset + 1] ?? "");
        const matchedFp = fingerprints[matchedIndex];
        const bindingKey = keys[matchedIndex];
        if (matchedIndex < 0 || !matchedFp || !bindingKey) continue;

        const parts = value.split("|");
        const providerId = Number.parseInt(parts[1] ?? "", 10);
        if (!Number.isFinite(providerId) || providerId <= 0) continue;

        let identityFp: string;
        let generation: string;
        let migratedValue = "";
        if (parts.length === 4 && parts[2] && parts[3]) {
          identityFp = parts[2];
          generation = parts[3];
        } else {
          identityFp = matchedFp;
          generation = this.generationToken();
          migratedValue = `1|${providerId}|${identityFp}|${generation}`;
        }

        const validated = await redis.eval(
          VALIDATE_LOOKUP_HIT_LUA,
          3,
          bindingKey,
          this.buildGenerationKey(scopeTag, identityFp),
          this.buildDescendantsKey(scopeTag, identityFp),
          value,
          generation,
          migratedValue,
          String(Math.max(0, Math.floor(slidingTtlSeconds))),
          GENERATION_FENCE_TTL_SECONDS
        );
        if (Number(validated) !== 1) continue;

        return {
          generation,
          identityFp,
          hint: {
            providerId,
            matchedIndex,
            matchedFp,
          },
        };
      }

      const generation = await redis.eval(
        ENSURE_GENERATION_LUA,
        1,
        this.buildGenerationKey(scopeTag, missIdentityFp),
        this.generationToken(),
        GENERATION_FENCE_TTL_SECONDS
      );
      if (!generation) return null;
      return {
        generation: String(generation),
        identityFp: missIdentityFp,
        hint: null,
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
    identityFp: string | null | undefined,
    expectedGeneration: string | null | undefined
  ): Promise<boolean> {
    if (
      !scopeTag ||
      !tipFp ||
      providerId <= 0 ||
      ttlSeconds <= 0 ||
      !identityFp ||
      !expectedGeneration
    ) {
      return false;
    }
    const redis = this.getReadyRedis();
    if (!redis) return false;

    const value = `1|${providerId}|${identityFp}|${expectedGeneration}`;
    try {
      const result = await redis.eval(
        CAS_WRITE_LUA,
        3,
        this.buildGenerationKey(scopeTag, identityFp),
        this.buildKey(scopeTag, tipFp),
        this.buildDescendantsKey(scopeTag, identityFp),
        expectedGeneration,
        value,
        ttlSeconds,
        GENERATION_FENCE_TTL_SECONDS
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
    identityFp: string | null | undefined,
    expectedGeneration: string | null | undefined
  ): Promise<boolean> {
    if (!scopeTag || !fp || !identityFp || !expectedGeneration) return false;
    const redis = this.getReadyRedis();
    if (!redis) return false;
    try {
      const result = await redis.eval(
        CAS_WRITE_LUA,
        3,
        this.buildGenerationKey(scopeTag, identityFp),
        this.buildKey(scopeTag, fp),
        this.buildDescendantsKey(scopeTag, identityFp),
        expectedGeneration,
        `0|${reason.slice(0, 32)}|${identityFp}|${expectedGeneration}`,
        TOMBSTONE_TTL_SECONDS,
        GENERATION_FENCE_TTL_SECONDS
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
   * 管理员终止前缀 Session 时原子递增 identity generation，再删除已登记 descendant
   * 及调用方已知祖先。在途旧请求仍携带旧 generation，后续 CAS write 会被拒绝。
   */
  async invalidate(scopeTag: string, identityFp: string, fingerprints: string[]): Promise<boolean> {
    if (!scopeTag || !identityFp) return false;
    const redis = this.getReadyRedis();
    if (!redis) return false;

    const knownKeys = [...new Set([identityFp, ...fingerprints].filter(Boolean))].map((fp) =>
      this.buildKey(scopeTag, fp)
    );

    try {
      const descendantsKey = this.buildDescendantsKey(scopeTag, identityFp);
      const descendants = await redis.smembers(descendantsKey);
      const keys = [...new Set([...knownKeys, ...descendants])];
      await redis.eval(
        INVALIDATE_LUA,
        keys.length + 2,
        this.buildGenerationKey(scopeTag, identityFp),
        descendantsKey,
        ...keys,
        this.generationToken(),
        GENERATION_FENCE_TTL_SECONDS
      );
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
