"use server";

import { getSession } from "@/lib/auth";
import {
  getActiveSessionsCache,
  getSessionDetailsCache,
  setActiveSessionsCache,
  setSessionDetailsCache,
} from "@/lib/cache/session-cache";
import { logger } from "@/lib/logger";
import type { ActiveSessionInfo } from "@/types/session";
import type { ActionResult } from "./types";

/**
 * 获取所有活跃 session 的详细信息（使用聚合数据 + 批量查询 + 缓存）
 * 用于实时监控页面
 *
 * 安全修复：添加用户权限隔离
 */
export async function getActiveSessions(): Promise<ActionResult<ActiveSessionInfo[]>> {
  try {
    // 0. 验证用户权限
    const authSession = await getSession();
    if (!authSession) {
      return {
        ok: false,
        error: "未登录",
      };
    }

    const isAdmin = authSession.user.role === "admin";
    const currentUserId = authSession.user.id;

    // 1. 尝试从缓存获取
    const cached = getActiveSessionsCache();
    if (cached) {
      logger.debug("[SessionCache] Active sessions cache hit");

      // 过滤：管理员可查看所有，普通用户只能查看自己的
      const filteredData = isAdmin ? cached : cached.filter((s) => s.userId === currentUserId);

      return {
        ok: true,
        data: filteredData.map((s) => ({
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

    // 5. 过滤：管理员可查看所有，普通用户只能查看自己的
    const filteredSessions = isAdmin
      ? sessionsData
      : sessionsData.filter((s) => s.userId === currentUserId);

    // 6. 转换格式
    const sessions: ActiveSessionInfo[] = filteredSessions.map((s) => ({
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
      `[SessionCache] Active sessions fetched and cached, count: ${sessions.length} (filtered for user: ${currentUserId})`
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
 * 修复：统一使用数据库聚合查询，确保与其他页面数据一致
 * 安全修复：添加用户权限隔离
 */
export async function getAllSessions(): Promise<
  ActionResult<{
    active: ActiveSessionInfo[];
    inactive: ActiveSessionInfo[];
  }>
> {
  try {
    // 0. 验证用户权限
    const authSession = await getSession();
    if (!authSession) {
      return {
        ok: false,
        error: "未登录",
      };
    }

    const isAdmin = authSession.user.role === "admin";
    const currentUserId = authSession.user.id;

    // 1. 尝试从缓存获取（使用不同的 key）
    const cacheKey = "all_sessions";
    const cached = getActiveSessionsCache(cacheKey);
    if (cached) {
      logger.debug("[SessionCache] All sessions cache hit");

      // 过滤：管理员可查看所有，普通用户只能查看自己的
      const filteredCached = isAdmin ? cached : cached.filter((s) => s.userId === currentUserId);

      // 分离活跃和非活跃（5 分钟内有请求为活跃）
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      const active: ActiveSessionInfo[] = [];
      const inactive: ActiveSessionInfo[] = [];

      for (const s of filteredCached) {
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

    // 5. 过滤：管理员可查看所有，普通用户只能查看自己的
    const filteredSessions = isAdmin
      ? sessionsData
      : sessionsData.filter((s) => s.userId === currentUserId);

    // 6. 分离活跃和非活跃（5 分钟内有请求为活跃）
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    const active: ActiveSessionInfo[] = [];
    const inactive: ActiveSessionInfo[] = [];

    for (const s of filteredSessions) {
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
      `[SessionCache] All sessions fetched and cached, active: ${active.length}, inactive: ${inactive.length} (filtered for user: ${currentUserId})`
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
 *
 * 安全修复：添加用户权限检查
 */
export async function getSessionMessages(sessionId: string): Promise<ActionResult<unknown>> {
  try {
    // 0. 验证用户权限
    const authSession = await getSession();
    if (!authSession) {
      return {
        ok: false,
        error: "未登录",
      };
    }

    const isAdmin = authSession.user.role === "admin";
    const currentUserId = authSession.user.id;

    // 1. 获取 session 统计数据以验证所有权
    const { aggregateSessionStats } = await import("@/repository/message");
    const sessionStats = await aggregateSessionStats(sessionId);

    if (!sessionStats) {
      return {
        ok: false,
        error: "Session 不存在",
      };
    }

    // 2. 权限检查：管理员可查看所有，普通用户只能查看自己的
    if (!isAdmin && sessionStats.userId !== currentUserId) {
      logger.warn(
        `[Security] User ${currentUserId} attempted to access messages of session ${sessionId} owned by user ${sessionStats.userId}`
      );
      return {
        ok: false,
        error: "无权访问该 Session",
      };
    }

    // 3. 获取 messages
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
 * 优化：添加缓存支持
 * 安全修复：添加用户权限检查
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
    // 0. 验证用户权限
    const authSession = await getSession();
    if (!authSession) {
      return {
        ok: false,
        error: "未登录",
      };
    }

    const isAdmin = authSession.user.role === "admin";
    const currentUserId = authSession.user.id;

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

    // 4. 权限检查：管理员可查看所有，普通用户只能查看自己的
    if (!sessionStats) {
      return {
        ok: false,
        error: "Session 不存在",
      };
    }

    if (!isAdmin && sessionStats.userId !== currentUserId) {
      logger.warn(
        `[Security] User ${currentUserId} attempted to access session ${sessionId} owned by user ${sessionStats.userId}`
      );
      return {
        ok: false,
        error: "无权访问该 Session",
      };
    }

    // 5. 并行获取 messages 和 response（不缓存，因为这些数据较大）
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
