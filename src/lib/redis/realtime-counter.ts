/**
 * Redis 实时计数器服务
 *
 * 功能:
 * - 用户级别实时统计 (并发数、今日请求数等)
 * - 活跃 session 追踪 (最近 5 分钟内有请求的 session)
 * - Fail Open 策略 (Redis 不可用时降级到数据库)
 *
 * Redis 数据结构:
 * - user:{userId}:stats - Hash: 用户统计 (concurrent_count, today_requests, today_cost)
 * - active_sessions - Sorted Set: 活跃 session (score=timestamp, member=sessionId)
 * - user:{userId}:active_sessions - Sorted Set: 用户活跃 session (score=timestamp, member=sessionId)
 */

import { getRedisClient } from "./client";
import { logger } from "@/lib/logger";
import { db } from "@/drizzle/db";
import { messageRequest, users } from "@/drizzle/schema";
import { sql, and, gte, isNull } from "drizzle-orm";
import type Redis from "ioredis";

/**
 * 用户统计数据
 */
export interface UserStats {
  userId: number;
  concurrentCount: number;
  todayRequests: number;
  todayCost: number; // USD
}

/**
 * 活跃 Session 数据
 */
export interface ActiveSession {
  sessionId: string;
  timestamp: number; // 最后活跃时间戳 (ms)
}

/**
 * Redis 实时计数器 (单例模式)
 */
export class RealtimeCounter {
  private static instance: RealtimeCounter | null = null;
  private redis: Redis | null = null;

  private constructor() {
    this.redis = getRedisClient();
  }

  /**
   * 获取 RealtimeCounter 单例
   */
  public static getInstance(): RealtimeCounter {
    if (!RealtimeCounter.instance) {
      RealtimeCounter.instance = new RealtimeCounter();
    }
    return RealtimeCounter.instance;
  }

  /**
   * 检查 Redis 是否可用
   */
  private isAvailable(): boolean {
    return !!this.redis && this.redis.status === "ready";
  }

  /**
   * 递增用户统计字段 (HINCRBY)
   * @param userId - 用户 ID
   * @param field - 字段名称 (concurrent_count, today_requests, today_cost)
   * @param increment - 递增值 (默认: 1)
   * @returns 更新后的值，失败时返回 null
   */
  public async incrementUserCount(
    userId: number,
    field: string,
    increment: number = 1
  ): Promise<number | null> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot increment user count - Fail Open");
      return null;
    }

    try {
      const key = `user:${userId}:stats`;
      const newValue = await this.redis!.hincrby(key, field, increment);

      // 设置兜底 TTL (24 小时)
      await this.redis!.expire(key, 86400);

      logger.debug("[RealtimeCounter] User count incremented", {
        userId,
        field,
        increment,
        newValue,
      });

      return newValue;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to increment user count", {
        userId,
        field,
        increment,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 递增用户统计字段 (浮点数，用于金额) (HINCRBYFLOAT)
   * @param userId - 用户 ID
   * @param field - 字段名称 (today_cost)
   * @param increment - 递增值
   * @returns 更新后的值，失败时返回 null
   */
  public async incrementUserCost(
    userId: number,
    field: string,
    increment: number
  ): Promise<number | null> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot increment user cost - Fail Open");
      return null;
    }

    try {
      const key = `user:${userId}:stats`;
      const newValueStr = await this.redis!.hincrbyfloat(key, field, increment);
      const newValue = parseFloat(newValueStr);

      // 设置兜底 TTL (24 小时)
      await this.redis!.expire(key, 86400);

      logger.debug("[RealtimeCounter] User cost incremented", {
        userId,
        field,
        increment,
        newValue,
      });

      return newValue;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to increment user cost", {
        userId,
        field,
        increment,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 追踪活跃 Session (ZADD)
   * @param sessionId - Session ID
   * @param userId - 用户 ID
   * @param timestamp - 时间戳 (默认: Date.now())
   * @returns 是否成功
   */
  public async trackActiveSession(
    sessionId: string,
    userId: number,
    timestamp?: number
  ): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot track active session - Fail Open");
      return false;
    }

    const now = timestamp ?? Date.now();

    try {
      // 追踪全局活跃 session
      await this.redis!.zadd("active_sessions", now, sessionId);

      // 追踪用户级别活跃 session
      const userKey = `user:${userId}:active_sessions`;
      await this.redis!.zadd(userKey, now, sessionId);

      // 设置兜底 TTL (1 小时)
      await this.redis!.expire("active_sessions", 3600);
      await this.redis!.expire(userKey, 3600);

      logger.debug("[RealtimeCounter] Active session tracked", {
        sessionId,
        userId,
        timestamp: now,
      });

      return true;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to track active session", {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 获取用户统计数据 (HGETALL)
   * @param userId - 用户 ID
   * @returns 用户统计数据，失败时返回 null
   */
  public async getUserStats(userId: number): Promise<UserStats | null> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot get user stats - Fail Open");
      return null;
    }

    try {
      const key = `user:${userId}:stats`;
      const data = await this.redis!.hgetall(key);

      const stats: UserStats = {
        userId,
        concurrentCount: parseInt(data.concurrent_count ?? "0", 10),
        todayRequests: parseInt(data.today_requests ?? "0", 10),
        todayCost: parseFloat(data.today_cost ?? "0"),
      };

      logger.debug("[RealtimeCounter] User stats retrieved", { userId, stats });

      return stats;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to get user stats", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 批量获取多个用户的统计数据 (Pipeline + HGETALL)
   * @param userIds - 用户 ID 列表
   * @returns 用户统计数据数组
   */
  public async getBatchUserStats(userIds: number[]): Promise<UserStats[]> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot get batch user stats - Fail Open");
      return [];
    }

    if (userIds.length === 0) {
      return [];
    }

    try {
      const pipeline = this.redis!.pipeline();

      // 批量查询
      for (const userId of userIds) {
        const key = `user:${userId}:stats`;
        pipeline.hgetall(key);
      }

      const results = await pipeline.exec();

      if (!results) {
        logger.error("[RealtimeCounter] Pipeline exec returned null");
        return [];
      }

      // 解析结果
      const stats: UserStats[] = [];
      for (let i = 0; i < userIds.length; i++) {
        const [error, data] = results[i];
        if (error) {
          logger.error("[RealtimeCounter] Pipeline command error", {
            userId: userIds[i],
            error: error.message,
          });
          continue;
        }

        const rawData = data as Record<string, string>;
        stats.push({
          userId: userIds[i],
          concurrentCount: parseInt(rawData.concurrent_count ?? "0", 10),
          todayRequests: parseInt(rawData.today_requests ?? "0", 10),
          todayCost: parseFloat(rawData.today_cost ?? "0"),
        });
      }

      logger.debug("[RealtimeCounter] Batch user stats retrieved", {
        count: stats.length,
      });

      return stats;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to get batch user stats", {
        userIds: userIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 获取活跃 Session 列表 (ZRANGEBYSCORE)
   * @param timeWindowMs - 时间窗口 (毫秒，默认: 5 分钟)
   * @param userId - 用户 ID (可选，如果指定则只返回该用户的活跃 session)
   * @returns 活跃 Session 列表
   */
  public async getActiveSessions(
    timeWindowMs: number = 300000,
    userId?: number
  ): Promise<ActiveSession[]> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot get active sessions - Fail Open");
      return [];
    }

    try {
      const now = Date.now();
      const minScore = now - timeWindowMs;

      const key = userId ? `user:${userId}:active_sessions` : "active_sessions";

      // ZRANGEBYSCORE key min max WITHSCORES
      const results = await this.redis!.zrangebyscore(key, minScore, "+inf", "WITHSCORES");

      // 解析结果 (格式: [member1, score1, member2, score2, ...])
      const sessions: ActiveSession[] = [];
      for (let i = 0; i < results.length; i += 2) {
        sessions.push({
          sessionId: results[i],
          timestamp: parseInt(results[i + 1], 10),
        });
      }

      logger.debug("[RealtimeCounter] Active sessions retrieved", {
        count: sessions.length,
        timeWindowMs,
        userId,
      });

      return sessions;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to get active sessions", {
        timeWindowMs,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 清理过期的活跃 Session (ZREMRANGEBYSCORE)
   * @param timeWindowMs - 时间窗口 (毫秒，默认: 5 分钟)
   * @returns 清理的 session 数量
   */
  public async cleanupExpiredSessions(timeWindowMs: number = 300000): Promise<number> {
    if (!this.isAvailable()) {
      logger.warn(
        "[RealtimeCounter] Redis unavailable, cannot cleanup expired sessions - Fail Open"
      );
      return 0;
    }

    try {
      const now = Date.now();
      const maxScore = now - timeWindowMs;

      // 清理全局活跃 session
      const globalDeleted = await this.redis!.zremrangebyscore("active_sessions", "-inf", maxScore);

      // 清理用户级别活跃 session (扫描所有 user:*:active_sessions key)
      const cursor = "0";
      const pattern = "user:*:active_sessions";
      let userDeleted = 0;

      // 使用 SCAN 遍历 key (避免阻塞)
      const keys = await this.redis!.keys(pattern);
      for (const key of keys) {
        const deleted = await this.redis!.zremrangebyscore(key, "-inf", maxScore);
        userDeleted += deleted;
      }

      const totalDeleted = globalDeleted + userDeleted;

      logger.info("[RealtimeCounter] Expired sessions cleaned up", {
        globalDeleted,
        userDeleted,
        totalDeleted,
        timeWindowMs,
      });

      return totalDeleted;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to cleanup expired sessions", {
        timeWindowMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * 重置用户今日统计 (用于每日零点重置)
   * @param userId - 用户 ID (如果不指定则重置所有用户)
   * @returns 是否成功
   */
  public async resetDailyStats(userId?: number): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot reset daily stats - Fail Open");
      return false;
    }

    try {
      if (userId) {
        // 重置单个用户
        const key = `user:${userId}:stats`;
        await this.redis!.hdel(key, "today_requests", "today_cost");
        logger.info("[RealtimeCounter] Daily stats reset for user", { userId });
      } else {
        // 重置所有用户 (扫描所有 user:*:stats key)
        const pattern = "user:*:stats";
        const keys = await this.redis!.keys(pattern);

        const pipeline = this.redis!.pipeline();
        for (const key of keys) {
          pipeline.hdel(key, "today_requests", "today_cost");
        }
        await pipeline.exec();

        logger.info("[RealtimeCounter] Daily stats reset for all users", {
          count: keys.length,
        });
      }

      return true;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to reset daily stats", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 清空所有 Redis 计数器数据 (用于测试或维护)
   * @returns 是否成功
   */
  public async clearAllCounters(): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot clear counters - Fail Open");
      return false;
    }

    try {
      // 删除所有用户统计 key
      const statsKeys = await this.redis!.keys("user:*:stats");
      const sessionKeys = await this.redis!.keys("user:*:active_sessions");
      const globalKeys = ["active_sessions"];

      const allKeys = [...statsKeys, ...sessionKeys, ...globalKeys];

      if (allKeys.length > 0) {
        await this.redis!.del(...allKeys);
      }

      logger.info("[RealtimeCounter] All counters cleared", {
        deletedKeys: allKeys.length,
      });

      return true;
    } catch (error) {
      logger.error("[RealtimeCounter] Failed to clear counters", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 从数据库恢复数据到 Redis (服务启动时调用)
   * 恢复最近 24 小时的统计数据和活跃 session
   * @returns 恢复统计信息
   */
  public async recoverFromDatabase(): Promise<{
    success: boolean;
    usersRecovered: number;
    sessionsRecovered: number;
    durationMs: number;
  }> {
    const startTime = Date.now();

    if (!this.isAvailable()) {
      logger.warn("[RealtimeCounter] Redis unavailable, cannot recover from database - Fail Open");
      return { success: false, usersRecovered: 0, sessionsRecovered: 0, durationMs: 0 };
    }

    try {
      logger.info("[RealtimeCounter] Starting data recovery from database...");

      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // 1. 查询最近 24 小时的用户统计数据
      const userStats = await db
        .select({
          userId: messageRequest.userId,
          requests: sql<number>`CAST(COUNT(*) AS INTEGER)`,
          cost: sql<string>`CAST(COALESCE(SUM(${messageRequest.costUsd}), 0) AS TEXT)`,
          activeSessions: sql<number>`CAST(COUNT(DISTINCT ${messageRequest.sessionId}) AS INTEGER)`,
        })
        .from(messageRequest)
        .where(
          and(
            gte(messageRequest.createdAt, twentyFourHoursAgo),
            isNull(messageRequest.deletedAt),
            isNull(messageRequest.durationMs) // 只统计未完成的请求作为并发
          )
        )
        .groupBy(messageRequest.userId);

      // 2. 查询活跃 session (最近 5 分钟内有请求)
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const activeSessions = await db
        .select({
          sessionId: messageRequest.sessionId,
          userId: messageRequest.userId,
          lastActive: sql<Date>`MAX(${messageRequest.createdAt})`,
        })
        .from(messageRequest)
        .where(and(gte(messageRequest.createdAt, fiveMinutesAgo), isNull(messageRequest.deletedAt)))
        .groupBy(messageRequest.sessionId, messageRequest.userId);

      // 3. 使用 Redis Pipeline 批量写入
      const pipeline = this.redis!.pipeline();

      // 恢复用户统计
      for (const stat of userStats) {
        const key = `user:${stat.userId}:stats`;
        pipeline.hset(key, {
          concurrent_count: stat.activeSessions.toString(),
          today_requests: stat.requests.toString(),
          today_cost: stat.cost,
        });
        pipeline.expire(key, 86400); // 24 小时 TTL
      }

      // 恢复活跃 session
      for (const session of activeSessions) {
        if (!session.sessionId) continue;

        const timestamp = session.lastActive.getTime();

        // 全局活跃 session
        pipeline.zadd("active_sessions", timestamp, session.sessionId);

        // 用户级别活跃 session
        const userKey = `user:${session.userId}:active_sessions`;
        pipeline.zadd(userKey, timestamp, session.sessionId);
        pipeline.expire(userKey, 3600); // 1 小时 TTL
      }

      pipeline.expire("active_sessions", 3600); // 1 小时 TTL

      // 执行批量操作
      const results = await pipeline.exec();

      const durationMs = Date.now() - startTime;

      logger.info("[RealtimeCounter] Data recovery completed", {
        usersRecovered: userStats.length,
        sessionsRecovered: activeSessions.length,
        commandsExecuted: results?.length ?? 0,
        durationMs,
      });

      return {
        success: true,
        usersRecovered: userStats.length,
        sessionsRecovered: activeSessions.length,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      logger.error("[RealtimeCounter] Failed to recover from database", {
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });

      return {
        success: false,
        usersRecovered: 0,
        sessionsRecovered: 0,
        durationMs,
      };
    }
  }

  /**
   * 获取计数器状态 (用于监控和调试)
   */
  public getStatus() {
    return {
      available: this.isAvailable(),
      redisStatus: this.redis?.status ?? "disconnected",
    };
  }
}

/**
 * 获取 RealtimeCounter 单例 (工厂函数)
 */
export function getRealtimeCounter(): RealtimeCounter {
  return RealtimeCounter.getInstance();
}
