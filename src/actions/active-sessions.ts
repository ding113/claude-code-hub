"use server";

import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";
import type { ActiveSessionInfo } from "@/types/session";
import {
  getActiveSessionsCache,
  setActiveSessionsCache,
  getSessionDetailsCache,
  setSessionDetailsCache,
} from "@/lib/cache/session-cache";

/**
 * 获取所有活跃 session 的详细信息（使用聚合数据 + 批量查询 + 缓存）
 * 用于实时监控页面
 */
export async function getActiveSessions(): Promise<ActionResult<ActiveSessionInfo[]>> {
  try {
    // 1. 尝试从缓存获取
    const cached = getActiveSessionsCache();
    if (cached) {
      logger.debug("[SessionCache] Active sessions cache hit");
      return {
        ok: true,
        data: cached.map((s) => ({
          sessionId: s.sessionId,
          userName: s.userName,
          userId: s.userId,
          keyId: s.keyId,
          keyName: s.keyName,
          providerId: s.providers[0]?.id || null,
          providerName: s.providers.map((p) => p.name).join(", ") || null,
          model: s.models.join(", ") || null,
          apiType: (s.apiType as "chat" | "codex") || "chat",
          startTime: s.firstRequestAt ? new Date(s.firstRequestAt).getTime() : Date.now(),
          inputTokens: s.totalInputTokens,
          outputTokens: s.totalOutputTokens,
          cacheCreationInputTokens: s.totalCacheCreationTokens,
          cacheReadInputTokens: s.totalCacheReadTokens,
          totalTokens:
            s.totalInputTokens +
            s.totalOutputTokens +
            s.totalCacheCreationTokens +
            s.totalCacheReadTokens,
          costUsd: s.totalCostUsd,
          status: "completed",
          durationMs: s.totalDurationMs,
          requestCount: s.requestCount,
        })),
      };
    }

    // 2. 从 SessionTracker 获取活跃 session ID 列表
    const { SessionTracker } = await import("@/lib/session-tracker");
    const sessionIds = await SessionTracker.getActiveSessions();

    if (sessionIds.length === 0) {
      return { ok: true, data: [] };
    }

    // 3. 使用批量聚合查询（性能优化）
    const { aggregateMultipleSessionStats } = await import("@/repository/message");
    const sessionsData = await aggregateMultipleSessionStats(sessionIds);

    // 4. 写入缓存
    setActiveSessionsCache(sessionsData);

    // 5. 转换格式
    const sessions: ActiveSessionInfo[] = sessionsData.map((s) => ({
      sessionId: s.sessionId,
      userName: s.userName,
      userId: s.userId,
      keyId: s.keyId,
      keyName: s.keyName,
      providerId: s.providers[0]?.id || null,
      providerName: s.providers.map((p) => p.name).join(", ") || null,
      model: s.models.join(", ") || null,
      apiType: (s.apiType as "chat" | "codex") || "chat",
      startTime: s.firstRequestAt ? new Date(s.firstRequestAt).getTime() : Date.now(),
      inputTokens: s.totalInputTokens,
      outputTokens: s.totalOutputTokens,
      cacheCreationInputTokens: s.totalCacheCreationTokens,
      cacheReadInputTokens: s.totalCacheReadTokens,
      totalTokens:
        s.totalInputTokens +
        s.totalOutputTokens +
        s.totalCacheCreationTokens +
        s.totalCacheReadTokens,
      costUsd: s.totalCostUsd,
      status: "completed",
      durationMs: s.totalDurationMs,
      requestCount: s.requestCount,
    }));

    logger.debug(
      `[SessionCache] Active sessions fetched and cached, count: ${sessions.length}`
    );

    return { ok: true, data: sessions };
  } catch (error) {
    logger.error("Failed to get active sessions:", error);
    return {
      ok: false,
      error: "获取活跃 session 失败",
    };
  }
}

/**
 * 获取所有 session（包括活跃和非活跃的）
 * 用于实时监控页面的完整视图
 *
 * ✅ 修复：统一使用数据库聚合查询，确保与其他页面数据一致
 */
export async function getAllSessions(): Promise<
  ActionResult<{
    active: ActiveSessionInfo[];
    inactive: ActiveSessionInfo[];
  }>
> {
  try {
    // 1. 尝试从缓存获取（使用不同的 key）
    const cacheKey = "all_sessions";
    const cached = getActiveSessionsCache(cacheKey);
    if (cached) {
      logger.debug("[SessionCache] All sessions cache hit");

      // 分离活跃和非活跃（5 分钟内有请求为活跃）
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      const active: ActiveSessionInfo[] = [];
      const inactive: ActiveSessionInfo[] = [];

      for (const s of cached) {
        const lastRequestTime = s.lastRequestAt ? new Date(s.lastRequestAt).getTime() : 0;
        const sessionInfo: ActiveSessionInfo = {
          sessionId: s.sessionId,
          userName: s.userName,
          userId: s.userId,
          keyId: s.keyId,
          keyName: s.keyName,
          providerId: s.providers[0]?.id || null,
          providerName: s.providers.map((p) => p.name).join(", ") || null,
          model: s.models.join(", ") || null,
          apiType: (s.apiType as "chat" | "codex") || "chat",
          startTime: s.firstRequestAt ? new Date(s.firstRequestAt).getTime() : Date.now(),
          inputTokens: s.totalInputTokens,
          outputTokens: s.totalOutputTokens,
          cacheCreationInputTokens: s.totalCacheCreationTokens,
          cacheReadInputTokens: s.totalCacheReadTokens,
          totalTokens:
            s.totalInputTokens +
            s.totalOutputTokens +
            s.totalCacheCreationTokens +
            s.totalCacheReadTokens,
          costUsd: s.totalCostUsd,
          status: "completed",
          durationMs: s.totalDurationMs,
          requestCount: s.requestCount,
        };

        if (lastRequestTime >= fiveMinutesAgo) {
          active.push(sessionInfo);
        } else {
          inactive.push(sessionInfo);
        }
      }

      return { ok: true, data: { active, inactive } };
    }

    // 2. 从 Redis 获取所有 session ID（包括活跃和非活跃）
    const { SessionManager } = await import("@/lib/session-manager");
    const allSessionIds = await SessionManager.getAllSessionIds();

    if (allSessionIds.length === 0) {
      return { ok: true, data: { active: [], inactive: [] } };
    }

    // 3. 使用批量聚合查询（性能优化）
    const { aggregateMultipleSessionStats } = await import("@/repository/message");
    const sessionsData = await aggregateMultipleSessionStats(allSessionIds);

    // 4. 写入缓存
    setActiveSessionsCache(sessionsData, cacheKey);

    // 5. 分离活跃和非活跃（5 分钟内有请求为活跃）
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    const active: ActiveSessionInfo[] = [];
    const inactive: ActiveSessionInfo[] = [];

    for (const s of sessionsData) {
      const lastRequestTime = s.lastRequestAt ? new Date(s.lastRequestAt).getTime() : 0;
      const sessionInfo: ActiveSessionInfo = {
        sessionId: s.sessionId,
        userName: s.userName,
        userId: s.userId,
        keyId: s.keyId,
        keyName: s.keyName,
        providerId: s.providers[0]?.id || null,
        providerName: s.providers.map((p) => p.name).join(", ") || null,
        model: s.models.join(", ") || null,
        apiType: (s.apiType as "chat" | "codex") || "chat",
        startTime: s.firstRequestAt ? new Date(s.firstRequestAt).getTime() : Date.now(),
        inputTokens: s.totalInputTokens,
        outputTokens: s.totalOutputTokens,
        cacheCreationInputTokens: s.totalCacheCreationTokens,
        cacheReadInputTokens: s.totalCacheReadTokens,
        totalTokens:
          s.totalInputTokens +
          s.totalOutputTokens +
          s.totalCacheCreationTokens +
          s.totalCacheReadTokens,
        costUsd: s.totalCostUsd,
        status: "completed",
        durationMs: s.totalDurationMs,
        requestCount: s.requestCount,
      };

      if (lastRequestTime >= fiveMinutesAgo) {
        active.push(sessionInfo);
      } else {
        inactive.push(sessionInfo);
      }
    }

    logger.debug(
      `[SessionCache] All sessions fetched and cached, active: ${active.length}, inactive: ${inactive.length}`
    );

    return { ok: true, data: { active, inactive } };
  } catch (error) {
    logger.error("Failed to get all sessions:", error);
    return {
      ok: false,
      error: "获取 session 列表失败",
    };
  }
}

/**
 * 获取指定 session 的 messages 内容
 * 仅当 STORE_SESSION_MESSAGES=true 时可用
 */
export async function getSessionMessages(sessionId: string): Promise<ActionResult<unknown>> {
  try {
    const { SessionManager } = await import("@/lib/session-manager");
    const messages = await SessionManager.getSessionMessages(sessionId);
    if (messages === null) {
      return {
        ok: false,
        error: "Messages 未存储或已过期",
      };
    }
    return {
      ok: true,
      data: messages,
    };
  } catch (error) {
    logger.error("Failed to get session messages:", error);
    return {
      ok: false,
      error: "获取 session messages 失败",
    };
  }
}

/**
 * 检查指定 session 是否有 messages 数据
 * 用于判断是否显示"查看详情"按钮
 */
export async function hasSessionMessages(sessionId: string): Promise<ActionResult<boolean>> {
  try {
    const { SessionManager } = await import("@/lib/session-manager");
    const messages = await SessionManager.getSessionMessages(sessionId);
    return {
      ok: true,
      data: messages !== null,
    };
  } catch (error) {
    logger.error("Failed to check session messages:", error);
    return {
      ok: true,
      data: false, // 出错时默认返回 false,避免显示无效按钮
    };
  }
}

/**
 * 获取 session 的完整详情（messages + response + 聚合统计）
 * 用于 session messages 详情页面
 *
 * ✅ 优化：添加缓存支持
 */
export async function getSessionDetails(sessionId: string): Promise<
  ActionResult<{
    messages: unknown | null;
    response: string | null;
    sessionStats: Awaited<
      ReturnType<typeof import("@/repository/message").aggregateSessionStats>
    > | null;
  }>
> {
  try {
    // 1. 尝试从缓存获取统计数据
    const cachedStats = getSessionDetailsCache(sessionId);

    let sessionStats: Awaited<
      ReturnType<typeof import("@/repository/message").aggregateSessionStats>
    > | null;

    if (cachedStats) {
      logger.debug(`[SessionCache] Session details cache hit: ${sessionId}`);
      sessionStats = cachedStats;
    } else {
      // 2. 从数据库查询
      const { aggregateSessionStats } = await import("@/repository/message");
      sessionStats = await aggregateSessionStats(sessionId);

      // 3. 写入缓存
      if (sessionStats) {
        setSessionDetailsCache(sessionId, sessionStats);
      }

      logger.debug(`[SessionCache] Session details fetched and cached: ${sessionId}`);
    }

    // 4. 并行获取 messages 和 response（不缓存，因为这些数据较大）
    const { SessionManager } = await import("@/lib/session-manager");
    const [messages, response] = await Promise.all([
      SessionManager.getSessionMessages(sessionId),
      SessionManager.getSessionResponse(sessionId),
    ]);

    return {
      ok: true,
      data: {
        messages,
        response,
        sessionStats,
      },
    };
  } catch (error) {
    logger.error("Failed to get session details:", error);
    return {
      ok: false,
      error: "获取 session 详情失败",
    };
  }
}
