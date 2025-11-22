"use server";

import { db } from "@/drizzle/db";
import { messageRequest, users, keys as keysTable, providers } from "@/drizzle/schema";
import { and, desc, eq, isNull, inArray, notInArray, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * 活动流条目（单个请求记录）
 */
export interface ActivityStreamItem {
  /** 请求 ID */
  id: number;
  /** Session ID */
  sessionId: string | null;
  /** 用户名 */
  userName: string;
  /** 用户 ID */
  userId: number;
  /** Key ID */
  keyId: number;
  /** Key 名称 */
  keyName: string;
  /** 供应商 ID */
  providerId: number | null;
  /** 供应商名称 */
  providerName: string | null;
  /** 模型名称 */
  model: string | null;
  /** 原始模型（计费模型） */
  originalModel: string | null;
  /** HTTP 状态码 */
  statusCode: number | null;
  /** 响应时间（毫秒） */
  durationMs: number | null;
  /** 成本（美元） */
  costUsd: string | null;
  /** 创建时间（Unix 时间戳，毫秒） */
  startTime: number;
  /** Input Tokens */
  inputTokens: number | null;
  /** Output Tokens */
  outputTokens: number | null;
  /** Cache Creation Tokens */
  cacheCreationInputTokens: number | null;
  /** Cache Read Tokens */
  cacheReadInputTokens: number | null;
}

/**
 * 获取最近的活动流（Redis 活跃 session + 数据库最新请求混合）
 *
 * 策略：
 * 1. 从 Redis 获取活跃 session ID 列表
 * 2. 查询这些 session 的最新请求（每个 session 1条）
 * 3. 如果不足 limit 条，补充数据库最新请求（排除已包含的 session）
 * 4. 按创建时间降序排序
 * 5. 去重并限制数量
 *
 * @param limit 最大返回条数（默认 20）
 */
export async function findRecentActivityStream(limit = 20): Promise<ActivityStreamItem[]> {
  try {
    // 1. 从 Redis 获取活跃 session ID
    const { SessionTracker } = await import("@/lib/session-tracker");
    const activeSessionIds = await SessionTracker.getActiveSessions();

    let activityItems: ActivityStreamItem[] = [];

    // 2. 查询活跃 session 的最新请求（每个 session 取最新1条）
    if (activeSessionIds.length > 0) {
      // 使用窗口函数获取每个 session 的最新请求
      const activeSessionRequests = await db
        .select({
          id: messageRequest.id,
          sessionId: messageRequest.sessionId,
          userName: users.name,
          userId: messageRequest.userId,
          keyId: keysTable.id,
          keyName: keysTable.name,
          providerId: messageRequest.providerId,
          providerName: providers.name,
          model: messageRequest.model,
          originalModel: messageRequest.originalModel,
          statusCode: messageRequest.statusCode,
          durationMs: messageRequest.durationMs,
          costUsd: messageRequest.costUsd,
          createdAt: messageRequest.createdAt,
          inputTokens: messageRequest.inputTokens,
          outputTokens: messageRequest.outputTokens,
          cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
          cacheReadInputTokens: messageRequest.cacheReadInputTokens,
          rowNum: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${messageRequest.sessionId} ORDER BY ${messageRequest.createdAt} DESC)`,
        })
        .from(messageRequest)
        .leftJoin(users, eq(messageRequest.userId, users.id))
        .leftJoin(keysTable, eq(messageRequest.key, keysTable.key))
        .leftJoin(providers, eq(messageRequest.providerId, providers.id))
        .where(
          and(isNull(messageRequest.deletedAt), inArray(messageRequest.sessionId, activeSessionIds))
        )
        .orderBy(desc(messageRequest.createdAt))
        .limit(limit * 2); // 获取足够的数据，后面会过滤

      // 过滤出每个 session 的最新一条（rowNum = 1）
      const latestPerSession = activeSessionRequests
        .filter((row) => row.rowNum === 1)
        .map((row) => ({
          id: row.id,
          sessionId: row.sessionId,
          userName: row.userName || "Unknown",
          userId: row.userId,
          keyId: row.keyId ?? 0,
          keyName: row.keyName || "Unknown",
          providerId: row.providerId,
          providerName: row.providerName,
          model: row.model,
          originalModel: row.originalModel,
          statusCode: row.statusCode,
          durationMs: row.durationMs,
          costUsd: row.costUsd,
          startTime: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheCreationInputTokens: row.cacheCreationInputTokens,
          cacheReadInputTokens: row.cacheReadInputTokens,
        }));

      activityItems = latestPerSession;

      logger.debug("[ActivityStream] Got active session requests", {
        activeSessionCount: activeSessionIds.length,
        latestRequestCount: latestPerSession.length,
      });
    }

    // 3. 如果不足 limit 条，补充数据库最新请求（排除已包含的 session）
    if (activityItems.length < limit) {
      const remaining = limit - activityItems.length;
      const excludedSessionIds = activityItems
        .map((item) => item.sessionId)
        .filter((sid): sid is string => sid !== null);

      const conditions = [isNull(messageRequest.deletedAt)];
      if (excludedSessionIds.length > 0) {
        conditions.push(notInArray(messageRequest.sessionId, excludedSessionIds));
      }

      const recentRequests = await db
        .select({
          id: messageRequest.id,
          sessionId: messageRequest.sessionId,
          userName: users.name,
          userId: messageRequest.userId,
          keyId: keysTable.id,
          keyName: keysTable.name,
          providerId: messageRequest.providerId,
          providerName: providers.name,
          model: messageRequest.model,
          originalModel: messageRequest.originalModel,
          statusCode: messageRequest.statusCode,
          durationMs: messageRequest.durationMs,
          costUsd: messageRequest.costUsd,
          createdAt: messageRequest.createdAt,
          inputTokens: messageRequest.inputTokens,
          outputTokens: messageRequest.outputTokens,
          cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
          cacheReadInputTokens: messageRequest.cacheReadInputTokens,
        })
        .from(messageRequest)
        .leftJoin(users, eq(messageRequest.userId, users.id))
        .leftJoin(keysTable, eq(messageRequest.key, keysTable.key))
        .leftJoin(providers, eq(messageRequest.providerId, providers.id))
        .where(and(...conditions))
        .orderBy(desc(messageRequest.createdAt))
        .limit(remaining);

      const additionalItems = recentRequests.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        userName: row.userName || "Unknown",
        userId: row.userId,
        keyId: row.keyId ?? 0,
        keyName: row.keyName || "Unknown",
        providerId: row.providerId,
        providerName: row.providerName,
        model: row.model,
        originalModel: row.originalModel,
        statusCode: row.statusCode,
        durationMs: row.durationMs,
        costUsd: row.costUsd,
        startTime: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationInputTokens: row.cacheCreationInputTokens,
        cacheReadInputTokens: row.cacheReadInputTokens,
      }));

      activityItems = [...activityItems, ...additionalItems];

      logger.debug("[ActivityStream] Added recent requests", {
        additionalCount: additionalItems.length,
        totalCount: activityItems.length,
      });
    }

    // 4. 按创建时间降序排序并去重
    const uniqueItems = new Map<number, ActivityStreamItem>();
    for (const item of activityItems) {
      if (!uniqueItems.has(item.id)) {
        uniqueItems.set(item.id, item);
      }
    }

    const sortedItems = Array.from(uniqueItems.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);

    logger.debug("[ActivityStream] Final activity stream", {
      totalUnique: uniqueItems.size,
      returned: sortedItems.length,
    });

    return sortedItems;
  } catch (error) {
    logger.error("Failed to get recent activity stream:", error);
    return [];
  }
}
