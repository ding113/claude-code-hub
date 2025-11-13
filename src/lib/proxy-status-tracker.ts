import { db } from "@/drizzle/db";
import { messageRequest, providers, keys, users } from "@/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { ProxyStatusResponse } from "@/types/proxy-status";
import { getRealtimeCounter } from "./redis/realtime-counter";
import { logger } from "./logger";

type ActiveRequestRow = {
  requestId: number;
  userId: number;
  keyString: string;
  keyName: string | null;
  providerId: number;
  providerName: string;
  model: string | null;
  createdAt: Date | string | null;
};

type LastRequestRow = {
  userId: number;
  requestId: number;
  keyString: string;
  keyName: string | null;
  providerId: number;
  providerName: string;
  model: string | null;
  endTime: Date | string | null;
};

function toTimestamp(value: Date | string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * 代理状态追踪器
 * 优先使用 Redis 实时数据，Redis 不可用时降级到数据库聚合
 */
export class ProxyStatusTracker {
  private static instance: ProxyStatusTracker | null = null;
  private realtimeCounter = getRealtimeCounter();

  static getInstance(): ProxyStatusTracker {
    if (!ProxyStatusTracker.instance) {
      ProxyStatusTracker.instance = new ProxyStatusTracker();
    }
    return ProxyStatusTracker.instance;
  }

  startRequest(params: {
    userId: number;
    userName: string;
    requestId: number;
    keyName: string;
    providerId: number;
    providerName: string;
    model: string;
    sessionId?: string;
  }): void {
    // 更新 Redis 实时计数器
    if (params.sessionId) {
      this.realtimeCounter.trackActiveSession(params.sessionId, params.userId).catch((error) => {
        logger.error("[ProxyStatusTracker] Failed to track active session", {
          error: error instanceof Error ? error.message : String(error),
          sessionId: params.sessionId,
          userId: params.userId,
        });
      });
    }

    // 递增今日请求数
    this.realtimeCounter.incrementUserCount(params.userId, "today_requests", 1).catch((error) => {
      logger.error("[ProxyStatusTracker] Failed to increment today_requests", {
        error: error instanceof Error ? error.message : String(error),
        userId: params.userId,
      });
    });

    // 递增并发数
    this.realtimeCounter.incrementUserCount(params.userId, "concurrent_count", 1).catch((error) => {
      logger.error("[ProxyStatusTracker] Failed to increment concurrent_count", {
        error: error instanceof Error ? error.message : String(error),
        userId: params.userId,
      });
    });
  }

  endRequest(userId: number, requestId: number, costUsd?: number): void {
    // 递减并发数
    this.realtimeCounter.incrementUserCount(userId, "concurrent_count", -1).catch((error) => {
      logger.error("[ProxyStatusTracker] Failed to decrement concurrent_count", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        requestId,
      });
    });

    // 递增今日消费
    if (costUsd && costUsd > 0) {
      this.realtimeCounter.incrementUserCost(userId, "today_cost", costUsd).catch((error) => {
        logger.error("[ProxyStatusTracker] Failed to increment today_cost", {
          error: error instanceof Error ? error.message : String(error),
          userId,
          costUsd,
        });
      });
    }
  }

  async getAllUsersStatus(): Promise<ProxyStatusResponse> {
    const now = Date.now();

    // 尝试从 Redis 获取实时数据
    const redisAvailable = this.realtimeCounter.getStatus().available;

    if (redisAvailable) {
      try {
        return await this.getAllUsersStatusFromRedis(now);
      } catch (error) {
        logger.error(
          "[ProxyStatusTracker] Failed to get status from Redis, falling back to database",
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // 降级到数据库查询
      }
    }

    // 降级到数据库查询
    logger.debug("[ProxyStatusTracker] Using database fallback for user status");
    return await this.getAllUsersStatusFromDatabase(now);
  }

  /**
   * 从 Redis 获取所有用户状态 (快速路径)
   * @private
   */
  private async getAllUsersStatusFromRedis(now: number): Promise<ProxyStatusResponse> {
    const [dbUsers, activeRequestRows, lastRequestRows] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
        })
        .from(users)
        .where(isNull(users.deletedAt)),
      this.loadActiveRequests(),
      this.loadLastRequests(),
    ]);

    // 批量获取 Redis 统计数据
    const userIds = dbUsers.map((u) => u.id);
    const redisStats = await this.realtimeCounter.getBatchUserStats(userIds);
    const redisStatsMap = new Map(redisStats.map((s) => [s.userId, s]));

    // 构建活跃请求映射
    const activeMap = new Map<number, ProxyStatusResponse["users"][number]["activeRequests"]>();
    for (const row of activeRequestRows) {
      const list = activeMap.get(row.userId) ?? [];
      const startTime = toTimestamp(row.createdAt) ?? now;
      list.push({
        requestId: row.requestId,
        keyName: row.keyName || row.keyString,
        providerId: row.providerId,
        providerName: row.providerName,
        model: row.model || "unknown",
        startTime,
        duration: now - startTime,
      });
      activeMap.set(row.userId, list);
    }

    // 构建最后请求映射
    const lastMap = new Map<number, LastRequestRow>();
    for (const row of lastRequestRows) {
      if (!lastMap.has(row.userId)) {
        lastMap.set(row.userId, row);
      }
    }

    // 构建用户状态响应
    const usersStatus = dbUsers.map((dbUser) => {
      const activeRequests = activeMap.get(dbUser.id) ?? [];
      const lastRow = lastMap.get(dbUser.id);

      const lastRequest = lastRow
        ? (() => {
            const endTime = toTimestamp(lastRow.endTime) ?? now;
            return {
              requestId: lastRow.requestId,
              keyName: lastRow.keyName || lastRow.keyString,
              providerId: lastRow.providerId,
              providerName: lastRow.providerName,
              model: lastRow.model || "unknown",
              endTime,
              elapsed: now - endTime,
            };
          })()
        : null;

      return {
        userId: dbUser.id,
        userName: dbUser.name,
        activeCount: activeRequests.length,
        activeRequests,
        lastRequest,
      };
    });

    logger.debug("[ProxyStatusTracker] User status retrieved from Redis", {
      userCount: usersStatus.length,
    });

    return { users: usersStatus };
  }

  /**
   * 从数据库获取所有用户状态 (降级路径)
   * @private
   */
  private async getAllUsersStatusFromDatabase(now: number): Promise<ProxyStatusResponse> {
    const [dbUsers, activeRequestRows, lastRequestRows] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
        })
        .from(users)
        .where(isNull(users.deletedAt)),
      this.loadActiveRequests(),
      this.loadLastRequests(),
    ]);

    const activeMap = new Map<number, ProxyStatusResponse["users"][number]["activeRequests"]>();
    for (const row of activeRequestRows) {
      const list = activeMap.get(row.userId) ?? [];
      const startTime = toTimestamp(row.createdAt) ?? now;
      list.push({
        requestId: row.requestId,
        keyName: row.keyName || row.keyString,
        providerId: row.providerId,
        providerName: row.providerName,
        model: row.model || "unknown",
        startTime,
        duration: now - startTime,
      });
      activeMap.set(row.userId, list);
    }

    const lastMap = new Map<number, LastRequestRow>();
    for (const row of lastRequestRows) {
      if (!lastMap.has(row.userId)) {
        lastMap.set(row.userId, row);
      }
    }

    const usersStatus = dbUsers.map((dbUser) => {
      const activeRequests = activeMap.get(dbUser.id) ?? [];
      const lastRow = lastMap.get(dbUser.id);

      const lastRequest = lastRow
        ? (() => {
            const endTime = toTimestamp(lastRow.endTime) ?? now;
            return {
              requestId: lastRow.requestId,
              keyName: lastRow.keyName || lastRow.keyString,
              providerId: lastRow.providerId,
              providerName: lastRow.providerName,
              model: lastRow.model || "unknown",
              endTime,
              elapsed: now - endTime,
            };
          })()
        : null;

      return {
        userId: dbUser.id,
        userName: dbUser.name,
        activeCount: activeRequests.length,
        activeRequests,
        lastRequest,
      };
    });

    return { users: usersStatus };
  }

  private async loadActiveRequests(): Promise<ActiveRequestRow[]> {
    const rows = await db
      .select({
        requestId: messageRequest.id,
        userId: messageRequest.userId,
        keyString: messageRequest.key,
        keyName: keys.name,
        providerId: providers.id,
        providerName: providers.name,
        model: messageRequest.model,
        createdAt: messageRequest.createdAt,
      })
      .from(messageRequest)
      .innerJoin(providers, eq(messageRequest.providerId, providers.id))
      .leftJoin(keys, and(eq(keys.key, messageRequest.key), isNull(keys.deletedAt)))
      .where(
        and(
          isNull(messageRequest.deletedAt),
          isNull(messageRequest.durationMs),
          isNull(providers.deletedAt)
        )
      );

    return rows as ActiveRequestRow[];
  }

  private async loadLastRequests(): Promise<LastRequestRow[]> {
    const query = sql<LastRequestRow>`
      SELECT DISTINCT ON (mr.user_id)
        mr.user_id AS "userId",
        mr.id AS "requestId",
        mr.key AS "keyString",
        k.name AS "keyName",
        mr.provider_id AS "providerId",
        p.name AS "providerName",
        mr.model AS "model",
        mr.updated_at AS "endTime"
      FROM message_request mr
      JOIN providers p ON mr.provider_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN keys k ON k.key = mr.key AND k.deleted_at IS NULL
      WHERE mr.deleted_at IS NULL
      ORDER BY mr.user_id, mr.updated_at DESC
    `;

    const result = await db.execute(query);
    return Array.from(result) as unknown as LastRequestRow[];
  }
}
