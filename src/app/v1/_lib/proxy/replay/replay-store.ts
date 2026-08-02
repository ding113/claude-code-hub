import "server-only";

import { and, eq, gt, lte, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { db } from "@/drizzle/db";
import { replayPayloads } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import { RedisKVStore } from "@/lib/redis/redis-kv-store";
import { RedisListStore } from "@/lib/redis/redis-list-store";

/**
 * F2 Replay 双层存储：
 * - Redis 热层（TTL 有界）：meta（状态机）+ chunks（客户端可见字节的 LIST）+ owner（租约）
 *   任意副本可读实时尾部——共享存储等效替代 CCHP 的本地磁盘 spool + owner-proxy。
 * - PG 持久层：仅存已通过计费终态屏障的完整响应（跨小时/跨滚动发布重放）。
 *
 * 一切 Redis 失败 fail-open：读 miss、写放弃，请求回退现状行为。
 */

export type ReplayStatus = "owning" | "completed" | "aborted";
export type ReplayDelivery = "stream" | "buffered";

export interface ReplayMeta {
  status: ReplayStatus;
  verifier: string;
  scopeTag: string;
  statusCode: number;
  /** 仅保留承载语义的响应头（content-type 等） */
  headers: Record<string, string>;
  /** buffered owner 不公开 live attach；缺失字段按旧版 stream 条目处理。 */
  delivery?: ReplayDelivery;
  format: string;
  model: string | null;
  chunkCount: number;
  byteSize: number;
  /** owner 心跳（epoch ms）：spool 每次冲刷时更新，attach 读者据此做 stall 检测 */
  heartbeatAt: number;
  messageRequestId?: number | null;
  abortReason?: string;
}

/** owner 租约 TTL：owner 崩溃后新的 claim 最多等这么久即可接管 */
const OWNER_LEASE_TTL_SECONDS = 45;

const LUA_COMPARE_DELETE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const LUA_COMPARE_EXPIRE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

const LUA_WRITE_OWNED = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return -1
end
local len = redis.call('LLEN', KEYS[3])
if #ARGV > 4 then
  len = redis.call('RPUSH', KEYS[3], unpack(ARGV, 5))
  if tonumber(ARGV[2]) > 0 then
    redis.call('EXPIRE', KEYS[3], ARGV[2])
  end
end
redis.call('SETEX', KEYS[2], ARGV[2], ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return len`;

const LUA_ABORT_OWNED = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SETEX', KEYS[2], ARGV[2], ARGV[3])
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[1])
return 1`;

const LUA_DISCARD_OWNED = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[1])
return 1`;

const LUA_COMPLETE_OWNED = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SETEX', KEYS[2], ARGV[2], ARGV[3])
redis.call('DEL', KEYS[1])
return 1`;

type RedisRawClient = Pick<Redis, "status" | "set" | "del"> & {
  eval(...args: [script: string, numkeys: number, ...rest: (string | number)[]]): Promise<unknown>;
};

export interface ReplayPersistedRow {
  replayId: string;
  verifier: string;
  scopeTag: string;
  keyId: number;
  userId: number;
  format: string;
  model: string | null;
  statusCode: number;
  headers: Record<string, string>;
  payload: string;
  byteSize: number;
  sourceMessageRequestId: number | null;
}

export class ReplayDurableConflictError extends Error {
  constructor(replayId: string) {
    super(`durable replay conflict for ${replayId.slice(0, 12)}`);
    this.name = "ReplayDurableConflictError";
  }
}

export const REPLAY_CLEANUP_BATCH_SIZE = 100;

function hasMatchingHeaders(
  expected: Record<string, string>,
  actual: Record<string, string> | null
): boolean {
  if (!actual) return false;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  return (
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key) => actual[key] === expected[key])
  );
}

function isMatchingPersistedReplay(
  expected: ReplayPersistedRow,
  actual: typeof replayPayloads.$inferSelect
): boolean {
  return (
    actual.verifier === expected.verifier &&
    actual.scopeTag === expected.scopeTag &&
    actual.keyId === expected.keyId &&
    actual.userId === expected.userId &&
    actual.format === expected.format &&
    actual.model === expected.model &&
    actual.statusCode === expected.statusCode &&
    hasMatchingHeaders(expected.headers, actual.headersJson) &&
    actual.payload === expected.payload &&
    actual.byteSize === expected.byteSize
  );
}

export class ReplayStore {
  private readonly meta: RedisKVStore<ReplayMeta>;
  private readonly chunks: RedisListStore;

  constructor() {
    const ttl = resolveReplayTtlSeconds();
    this.meta = new RedisKVStore<ReplayMeta>({
      prefix: "cch:replay:meta:",
      defaultTtlSeconds: ttl,
    });
    this.chunks = new RedisListStore({ prefix: "cch:replay:chunks:" });
  }

  private getRawRedis(): RedisRawClient | null {
    const redis = getRedisClient({ allowWhenRateLimitDisabled: true }) as RedisRawClient | null;
    if (redis?.status !== "ready") return null;
    return redis;
  }

  async getMeta(replayId: string): Promise<ReplayMeta | null> {
    return this.meta.get(replayId);
  }

  async setMeta(replayId: string, meta: ReplayMeta, ttlSeconds?: number): Promise<boolean> {
    return this.meta.set(replayId, meta, ttlSeconds ?? resolveReplayTtlSeconds());
  }

  async appendChunks(replayId: string, values: string[]): Promise<number | null> {
    return this.chunks.rpushBatch(replayId, values, resolveReplayTtlSeconds());
  }

  /**
   * owner 热层写入：token 校验、chunk 追加、owning meta 更新和租约续期在同一 Lua
   * 内完成，避免旧 owner 在租约交接窗口污染新 owner 的 chunks/meta。
   * null 表示 Redis 不可用，false 表示 token 已失效，number 为当前 chunk 总数。
   */
  async writeOwned(
    replayId: string,
    ownerToken: string,
    meta: ReplayMeta,
    values: string[] = []
  ): Promise<number | null | false> {
    const redis = this.getRawRedis();
    if (!redis) return null;
    try {
      const result = await redis.eval(
        LUA_WRITE_OWNED,
        3,
        `cch:replay:owner:${replayId}`,
        `cch:replay:meta:${replayId}`,
        `cch:replay:chunks:${replayId}`,
        ownerToken,
        resolveReplayTtlSeconds(),
        OWNER_LEASE_TTL_SECONDS,
        JSON.stringify(meta),
        ...values
      );
      const length = typeof result === "number" ? result : Number(result);
      return length === -1 ? false : length;
    } catch (error) {
      logger.debug("[ReplayStore] fenced owner write failed", {
        replayId: replayId.slice(0, 12),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** 从 offset（0-based）读到当前末尾；Redis 不可用返回 null。 */
  async readChunks(replayId: string, fromIndex: number): Promise<string[] | null> {
    return this.chunks.lrangeFrom(replayId, fromIndex);
  }

  async deleteEntry(replayId: string): Promise<void> {
    await Promise.all([this.meta.delete(replayId), this.chunks.delete(replayId)]);
  }

  async deleteChunks(replayId: string): Promise<void> {
    await this.chunks.delete(replayId);
  }

  /** owner 租约：SET NX EX。成功即成为唯一 owner；Redis 不可用视为失败（不做 replay）。 */
  async tryClaimOwner(replayId: string, ownerToken: string): Promise<boolean> {
    const redis = this.getRawRedis();
    if (!redis) return false;
    try {
      const result = await redis.set(
        `cch:replay:owner:${replayId}`,
        ownerToken,
        "EX",
        OWNER_LEASE_TTL_SECONDS,
        "NX"
      );
      return result === "OK";
    } catch (error) {
      logger.warn("[ReplayStore] owner claim failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 心跳续租（compare-and-expire）：仅 token 仍属自己时续期，防止租约过期后
   * 被并发 claim 抢走、旧 owner 却继续无条件覆写租约。
   * 返回 false 表示所有权已失（或续租异常，保守视为失去）；
   * Redis 不可用返回 true——状态未知，不惩罚仍在正常冲刷的 owner。
   */
  async renewOwnerLease(replayId: string, ownerToken: string): Promise<boolean> {
    const redis = this.getRawRedis();
    if (!redis) return true;
    try {
      const result = await redis.eval(
        LUA_COMPARE_EXPIRE,
        1,
        `cch:replay:owner:${replayId}`,
        ownerToken,
        OWNER_LEASE_TTL_SECONDS
      );
      return result === 1;
    } catch {
      return false;
    }
  }

  /** 释放租约（compare-delete，只删自己的）。 */
  async releaseOwner(replayId: string, ownerToken: string): Promise<void> {
    const redis = this.getRawRedis();
    if (!redis) return;
    try {
      await redis.eval(LUA_COMPARE_DELETE, 1, `cch:replay:owner:${replayId}`, ownerToken);
    } catch {
      // 租约会自然过期
    }
  }

  /** 仅当前 token 仍持有租约时，原子终止条目并清理热层响应块。 */
  async abortOwned(replayId: string, ownerToken: string, meta: ReplayMeta): Promise<boolean> {
    const redis = this.getRawRedis();
    if (!redis) return false;
    try {
      const result = await redis.eval(
        LUA_ABORT_OWNED,
        3,
        `cch:replay:owner:${replayId}`,
        `cch:replay:meta:${replayId}`,
        `cch:replay:chunks:${replayId}`,
        ownerToken,
        resolveReplayTtlSeconds(),
        JSON.stringify(meta)
      );
      return result === 1;
    } catch (error) {
      logger.debug("[ReplayStore] fenced abort failed", {
        replayId: replayId.slice(0, 12),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** 当前 owner 放弃热层候选，但不写 aborted，避免遮蔽已存在的 PG winner。 */
  async discardOwned(replayId: string, ownerToken: string): Promise<boolean> {
    const redis = this.getRawRedis();
    if (!redis) return false;
    try {
      const result = await redis.eval(
        LUA_DISCARD_OWNED,
        3,
        `cch:replay:owner:${replayId}`,
        `cch:replay:meta:${replayId}`,
        `cch:replay:chunks:${replayId}`,
        ownerToken
      );
      return result === 1;
    } catch (error) {
      logger.debug("[ReplayStore] fenced discard failed", {
        replayId: replayId.slice(0, 12),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** 仅当前 token 仍持有租约时，原子翻转 completed meta 并释放租约。 */
  async completeOwned(replayId: string, ownerToken: string, meta: ReplayMeta): Promise<boolean> {
    const redis = this.getRawRedis();
    if (!redis) return false;
    try {
      const result = await redis.eval(
        LUA_COMPLETE_OWNED,
        2,
        `cch:replay:owner:${replayId}`,
        `cch:replay:meta:${replayId}`,
        ownerToken,
        resolveReplayTtlSeconds(),
        JSON.stringify(meta)
      );
      return result === 1;
    } catch (error) {
      logger.debug("[ReplayStore] fenced completion failed", {
        replayId: replayId.slice(0, 12),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ===== PG 完成持久层 =====

  /**
   * 写 PG 完成持久层。失败必须向调用方抛出：completeAfterBilling 依赖该异常
   * 走 abort——payload 未 durable 时绝不能把 meta 翻成 completed。
   * （过期行清理由 instrumentation 定时调度器负责，不在写路径顺带执行。）
   */
  async persistCompleted(row: ReplayPersistedRow): Promise<"persisted" | "existing"> {
    const env = getEnvConfig();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + env.REPLAY_COMPLETED_TTL_SECONDS * 1000);
    const persistedValues = {
      verifier: row.verifier,
      scopeTag: row.scopeTag,
      keyId: row.keyId,
      userId: row.userId,
      format: row.format,
      model: row.model,
      statusCode: row.statusCode,
      headersJson: row.headers,
      payload: row.payload,
      byteSize: row.byteSize,
      sourceMessageRequestId: row.sourceMessageRequestId,
      expiresAt,
    };
    try {
      const upserted = await db
        .insert(replayPayloads)
        .values({
          replayId: row.replayId,
          ...persistedValues,
        })
        .onConflictDoUpdate({
          target: replayPayloads.replayId,
          set: {
            ...persistedValues,
            createdAt: now,
          },
          setWhere: lte(replayPayloads.expiresAt, now),
        })
        .returning({ replayId: replayPayloads.replayId });

      if (upserted.length > 0) return "persisted";

      const existingRows = await db
        .select()
        .from(replayPayloads)
        .where(and(eq(replayPayloads.replayId, row.replayId), gt(replayPayloads.expiresAt, now)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing || !isMatchingPersistedReplay(row, existing)) {
        throw new ReplayDurableConflictError(row.replayId);
      }
      return "existing";
    } catch (error) {
      logger.warn("[ReplayStore] persistCompleted failed", {
        error: error instanceof Error ? error.message : String(error),
        replayId: row.replayId.slice(0, 12),
      });
      throw error;
    }
  }

  /** 删除单批 PG 持久层过期行；返回删除数（错误由调用方处理）。 */
  async cleanupExpired(cutoff = new Date()): Promise<number> {
    const deleted = await db.execute(sql`
      WITH doomed AS (
        SELECT replay_id
        FROM replay_payloads
        WHERE expires_at < ${cutoff}
        ORDER BY expires_at, replay_id
        LIMIT ${REPLAY_CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM replay_payloads AS rp
      USING doomed
      WHERE rp.replay_id = doomed.replay_id
      RETURNING 1
    `);

    return Array.isArray(deleted) ? deleted.length : 0;
  }

  async findCompleted(replayId: string): Promise<typeof replayPayloads.$inferSelect | null> {
    try {
      const rows = await db
        .select()
        .from(replayPayloads)
        .where(and(eq(replayPayloads.replayId, replayId), gt(replayPayloads.expiresAt, new Date())))
        .limit(1);
      return rows[0] ?? null;
    } catch (error) {
      logger.warn("[ReplayStore] findCompleted failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export function resolveReplayTtlSeconds(): number {
  try {
    return getEnvConfig().REPLAY_TTL_SECONDS;
  } catch {
    return 600;
  }
}

let sharedReplayStore: ReplayStore | null = null;

export function getReplayStore(): ReplayStore {
  if (!sharedReplayStore) {
    sharedReplayStore = new ReplayStore();
  }
  return sharedReplayStore;
}
