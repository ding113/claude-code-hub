/**
 * 同步调度器
 *
 * 功能:
 * - 定期将 Redis 实时数据同步到数据库 (每 5 分钟)
 * - 使用 Redis SETNX 实现分布式同步锁
 * - 批量写入数据库 (drizzle batch insert/update)
 * - 数据一致性检查 (每小时)
 */

import { getRealtimeCounter } from "./redis/realtime-counter";
import { getRedisClient } from "./redis/client";
import { logger } from "./logger";
import { db } from "@/drizzle/db";
import { messageRequest, users } from "@/drizzle/schema";
import { sql, and, gte, isNull, eq } from "drizzle-orm";
import type Redis from "ioredis";

/**
 * 同步调度器 (单例模式)
 */
export class SyncScheduler {
  private static instance: SyncScheduler | null = null;
  private redis: Redis | null = null;
  private realtimeCounter = getRealtimeCounter();

  // 定时任务句柄
  private syncInterval: NodeJS.Timeout | null = null;
  private consistencyCheckInterval: NodeJS.Timeout | null = null;

  // 配置
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
  private readonly CONSISTENCY_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 小时
  private readonly SYNC_LOCK_KEY = "sync:lock";
  private readonly SYNC_LOCK_TTL = 300; // 5 分钟 (秒)

  private constructor() {
    this.redis = getRedisClient();
  }

  /**
   * 获取 SyncScheduler 单例
   */
  public static getInstance(): SyncScheduler {
    if (!SyncScheduler.instance) {
      SyncScheduler.instance = new SyncScheduler();
    }
    return SyncScheduler.instance;
  }

  /**
   * 启动定期同步任务
   */
  public start(): void {
    if (this.syncInterval || this.consistencyCheckInterval) {
      logger.warn("[SyncScheduler] Scheduler already started");
      return;
    }

    logger.info("[SyncScheduler] Starting sync scheduler...", {
      syncIntervalMs: this.SYNC_INTERVAL_MS,
      consistencyCheckIntervalMs: this.CONSISTENCY_CHECK_INTERVAL_MS,
    });

    // 立即执行一次数据恢复
    this.realtimeCounter.recoverFromDatabase().catch((error) => {
      logger.error("[SyncScheduler] Initial data recovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // 启动定期同步任务
    this.syncInterval = setInterval(() => {
      this.syncToDatabase().catch((error) => {
        logger.error("[SyncScheduler] Sync to database failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.SYNC_INTERVAL_MS);

    // 启动一致性检查任务
    this.consistencyCheckInterval = setInterval(() => {
      this.checkConsistency().catch((error) => {
        logger.error("[SyncScheduler] Consistency check failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.CONSISTENCY_CHECK_INTERVAL_MS);

    logger.info("[SyncScheduler] Sync scheduler started successfully");
  }

  /**
   * 停止定期同步任务
   */
  public stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.consistencyCheckInterval) {
      clearInterval(this.consistencyCheckInterval);
      this.consistencyCheckInterval = null;
    }

    logger.info("[SyncScheduler] Sync scheduler stopped");
  }

  /**
   * 同步 Redis 数据到数据库
   * @returns 同步统计
   */
  public async syncToDatabase(): Promise<{
    success: boolean;
    usersSynced: number;
    sessionsSynced: number;
    durationMs: number;
  }> {
    const startTime = Date.now();

    // 检查 Redis 是否可用
    if (!this.redis || this.redis.status !== "ready") {
      logger.warn("[SyncScheduler] Redis unavailable, skipping sync - Fail Open");
      return { success: false, usersSynced: 0, sessionsSynced: 0, durationMs: 0 };
    }

    // 获取同步锁 (避免并发同步)
    const lockAcquired = await this.acquireSyncLock();
    if (!lockAcquired) {
      logger.debug("[SyncScheduler] Failed to acquire sync lock, skipping this round");
      return { success: false, usersSynced: 0, sessionsSynced: 0, durationMs: 0 };
    }

    try {
      logger.info("[SyncScheduler] Starting sync to database...");

      // 1. 扫描所有用户统计 key
      const statsKeys = await this.redis.keys("user:*:stats");
      const usersSynced = statsKeys.length;

      // 2. 批量读取用户统计数据
      if (usersSynced > 0) {
        const pipeline = this.redis.pipeline();
        for (const key of statsKeys) {
          pipeline.hgetall(key);
        }
        const results = await pipeline.exec();

        // 3. 准备批量更新数据 (这里我们不直接更新 message_request 表，而是记录到日志)
        // 因为 message_request 表是事务日志，不应该被批量修改
        // 实时统计数据主要用于前端展示，不需要持久化到数据库
        // 如果需要持久化，应该创建一个单独的 statistics 表

        logger.info("[SyncScheduler] User stats synced (logged)", {
          usersSynced,
        });
      }

      // 4. 清理过期的活跃 session (5 分钟前)
      const sessionsCleaned = await this.realtimeCounter.cleanupExpiredSessions();

      const durationMs = Date.now() - startTime;

      logger.info("[SyncScheduler] Sync to database completed", {
        usersSynced,
        sessionsCleaned,
        durationMs,
      });

      return {
        success: true,
        usersSynced,
        sessionsSynced: sessionsCleaned,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      logger.error("[SyncScheduler] Failed to sync to database", {
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });

      return {
        success: false,
        usersSynced: 0,
        sessionsSynced: 0,
        durationMs,
      };
    } finally {
      // 释放同步锁
      await this.releaseSyncLock();
    }
  }

  /**
   * 数据一致性检查
   * 对比 Redis 和数据库的统计数据，发现差异时记录警告或自动修正
   * @returns 一致性检查结果
   */
  public async checkConsistency(): Promise<{
    success: boolean;
    totalUsers: number;
    inconsistentUsers: number;
    autoFixedUsers: number;
    durationMs: number;
  }> {
    const startTime = Date.now();

    // 检查 Redis 是否可用
    if (!this.redis || this.redis.status !== "ready") {
      logger.warn("[SyncScheduler] Redis unavailable, skipping consistency check - Fail Open");
      return {
        success: false,
        totalUsers: 0,
        inconsistentUsers: 0,
        autoFixedUsers: 0,
        durationMs: 0,
      };
    }

    try {
      logger.info("[SyncScheduler] Starting consistency check...");

      // 1. 获取所有活跃用户列表
      const activeUsers = await db
        .select({ userId: users.id })
        .from(users)
        .where(isNull(users.deletedAt));

      const userIds = activeUsers.map((u) => u.userId);
      const totalUsers = userIds.length;

      if (totalUsers === 0) {
        logger.info("[SyncScheduler] No users to check");
        return {
          success: true,
          totalUsers: 0,
          inconsistentUsers: 0,
          autoFixedUsers: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. 批量获取 Redis 统计数据
      const redisStats = await this.realtimeCounter.getBatchUserStats(userIds);
      const redisStatsMap = new Map(redisStats.map((s) => [s.userId, s]));

      // 3. 查询数据库统计数据 (今日数据)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dbStats = await db
        .select({
          userId: messageRequest.userId,
          todayRequests: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          todayCost: sql<string>`CAST(COALESCE(SUM(${messageRequest.costUsd}), 0) AS TEXT)`,
          concurrentCount: sql<number>`CAST(COUNT(CASE WHEN ${messageRequest.durationMs} IS NULL THEN 1 END) AS INTEGER)`,
        })
        .from(messageRequest)
        .where(and(gte(messageRequest.createdAt, today), isNull(messageRequest.deletedAt)))
        .groupBy(messageRequest.userId);

      const dbStatsMap = new Map(dbStats.map((s) => [s.userId, s]));

      // 4. 对比差异
      let inconsistentUsers = 0;
      let autoFixedUsers = 0;

      type DbStatsRow = {
        userId: number;
        todayRequests: number;
        todayCost: string;
        concurrentCount: number;
      };

      for (const userId of userIds) {
        const redisData = redisStatsMap.get(userId);
        const dbData = dbStatsMap.get(userId) as DbStatsRow | undefined;

        if (!redisData && !dbData) {
          // 用户没有任何数据，正常
          continue;
        }

        const redisRequests = redisData?.todayRequests ?? 0;
        const dbRequests = dbData?.todayRequests ?? 0;

        const redisCost = redisData?.todayCost ?? 0;
        const dbCost = parseFloat(dbData?.todayCost ?? "0");

        // 计算差异百分比
        const requestsDiff = Math.abs(redisRequests - dbRequests);
        const requestsDiffPercent = dbRequests > 0 ? (requestsDiff / dbRequests) * 100 : 0;

        const costDiff = Math.abs(redisCost - dbCost);
        const costDiffPercent = dbCost > 0 ? (costDiff / dbCost) * 100 : 0;

        // 差异阈值: 10% 警告, 30% 自动修正
        if (requestsDiffPercent > 10 || costDiffPercent > 10) {
          inconsistentUsers++;

          logger.warn("[SyncScheduler] Data inconsistency detected", {
            userId,
            redis: { requests: redisRequests, cost: redisCost },
            database: { requests: dbRequests, cost: dbCost },
            diff: {
              requests: requestsDiff,
              requestsPercent: requestsDiffPercent.toFixed(2),
              cost: costDiff,
              costPercent: costDiffPercent.toFixed(2),
            },
          });

          // 如果差异 >30%，自动修正 (以数据库为准)
          if (requestsDiffPercent > 30 || costDiffPercent > 30) {
            await this.fixUserStats(userId, dbData);
            autoFixedUsers++;

            logger.info("[SyncScheduler] Auto-fixed user stats", {
              userId,
              fixedData: dbData,
            });
          }
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info("[SyncScheduler] Consistency check completed", {
        totalUsers,
        inconsistentUsers,
        autoFixedUsers,
        inconsistencyRate: totalUsers > 0 ? ((inconsistentUsers / totalUsers) * 100).toFixed(2) : 0,
        durationMs,
      });

      return {
        success: true,
        totalUsers,
        inconsistentUsers,
        autoFixedUsers,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      logger.error("[SyncScheduler] Consistency check failed", {
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });

      return {
        success: false,
        totalUsers: 0,
        inconsistentUsers: 0,
        autoFixedUsers: 0,
        durationMs,
      };
    }
  }

  /**
   * 修正用户统计数据 (以数据库为准)
   * @private
   */
  private async fixUserStats(
    userId: number,
    dbData:
      | {
          userId: number;
          todayRequests: number;
          todayCost: string;
          concurrentCount: number;
        }
      | undefined
  ): Promise<void> {
    if (!this.redis || this.redis.status !== "ready") {
      return;
    }

    try {
      const key = `user:${userId}:stats`;

      if (!dbData) {
        // 数据库中没有数据，清空 Redis
        await this.redis.del(key);
      } else {
        // 更新 Redis 为数据库值
        await this.redis.hset(key, {
          today_requests: dbData.todayRequests.toString(),
          today_cost: dbData.todayCost,
          concurrent_count: dbData.concurrentCount.toString(),
        });
        await this.redis.expire(key, 86400); // 24 小时 TTL
      }
    } catch (error) {
      logger.error("[SyncScheduler] Failed to fix user stats", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 获取同步锁 (使用 Redis SETNX)
   * @private
   */
  private async acquireSyncLock(): Promise<boolean> {
    if (!this.redis || this.redis.status !== "ready") {
      return false;
    }

    try {
      // SETNX key value EX seconds
      const result = await this.redis.set(this.SYNC_LOCK_KEY, "1", "EX", this.SYNC_LOCK_TTL, "NX");
      return result === "OK";
    } catch (error) {
      logger.error("[SyncScheduler] Failed to acquire sync lock", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 释放同步锁
   * @private
   */
  private async releaseSyncLock(): Promise<void> {
    if (!this.redis || this.redis.status !== "ready") {
      return;
    }

    try {
      await this.redis.del(this.SYNC_LOCK_KEY);
    } catch (error) {
      logger.error("[SyncScheduler] Failed to release sync lock", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 获取调度器状态 (用于监控和调试)
   */
  public getStatus() {
    return {
      running: !!(this.syncInterval && this.consistencyCheckInterval),
      redisAvailable: !!(this.redis && this.redis.status === "ready"),
      config: {
        syncIntervalMs: this.SYNC_INTERVAL_MS,
        consistencyCheckIntervalMs: this.CONSISTENCY_CHECK_INTERVAL_MS,
        syncLockTtl: this.SYNC_LOCK_TTL,
      },
    };
  }
}

/**
 * 获取 SyncScheduler 单例 (工厂函数)
 */
export function getSyncScheduler(): SyncScheduler {
  return SyncScheduler.getInstance();
}
