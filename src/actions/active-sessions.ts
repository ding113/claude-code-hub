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
import { summarizeTerminateSessionsBatch } from "./active-sessions-utils";
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
 * 获取所有 session（包括活跃和非活跃的）- 支持分页
 * 用于实时监控页面的完整视图
 *
 * 修复：统一使用数据库聚合查询，确保与其他页面数据一致
 * 安全修复：添加用户权限隔离
 *
 * @param activePage - 活跃 session 页码（从 1 开始）
 * @param inactivePage - 非活跃 session 页码（从 1 开始）
 * @param pageSize - 每页数量（默认 20）
 */
export async function getAllSessions(
  activePage: number = 1,
  inactivePage: number = 1,
  pageSize: number = 20
): Promise<
  ActionResult<{
    active: ActiveSessionInfo[];
    inactive: ActiveSessionInfo[];
    totalActive: number;
    totalInactive: number;
    hasMoreActive: boolean;
    hasMoreInactive: boolean;
  }>
> {
  // Input validation: ensure page numbers and pageSize are positive integers
  const safeActivePage = Math.max(1, Number.isFinite(activePage) ? Math.floor(activePage) : 1);
  const safeInactivePage = Math.max(
    1,
    Number.isFinite(inactivePage) ? Math.floor(inactivePage) : 1
  );
  const safePageSize = Math.min(
    Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 20),
    200
  );

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

      // 应用分页
      const totalActive = active.length;
      const totalInactive = inactive.length;
      const activeOffset = (safeActivePage - 1) * safePageSize;
      const inactiveOffset = (safeInactivePage - 1) * safePageSize;
      const paginatedActive = active.slice(activeOffset, activeOffset + safePageSize);
      const paginatedInactive = inactive.slice(inactiveOffset, inactiveOffset + safePageSize);

      return {
        ok: true,
        data: {
          active: paginatedActive,
          inactive: paginatedInactive,
          totalActive,
          totalInactive,
          hasMoreActive: activeOffset + paginatedActive.length < totalActive,
          hasMoreInactive: inactiveOffset + paginatedInactive.length < totalInactive,
        },
      };
    }

    // 2. 从 Redis 获取所有 session ID（包括活跃和非活跃）
    const { SessionManager } = await import("@/lib/session-manager");
    const allSessionIds = await SessionManager.getAllSessionIds();

    if (allSessionIds.length === 0) {
      return {
        ok: true,
        data: {
          active: [],
          inactive: [],
          totalActive: 0,
          totalInactive: 0,
          hasMoreActive: false,
          hasMoreInactive: false,
        },
      };
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

    // 7. 应用分页
    const totalActive = active.length;
    const totalInactive = inactive.length;
    const activeOffset = (safeActivePage - 1) * safePageSize;
    const inactiveOffset = (safeInactivePage - 1) * safePageSize;
    const paginatedActive = active.slice(activeOffset, activeOffset + safePageSize);
    const paginatedInactive = inactive.slice(inactiveOffset, inactiveOffset + safePageSize);

    return {
      ok: true,
      data: {
        active: paginatedActive,
        inactive: paginatedInactive,
        totalActive,
        totalInactive,
        hasMoreActive: activeOffset + paginatedActive.length < totalActive,
        hasMoreInactive: inactiveOffset + paginatedInactive.length < totalInactive,
      },
    };
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
 *
 * @param sessionId - Session ID
 * @param requestSequence - 可选，请求序号。提供时检查特定请求的消息
 */
export async function hasSessionMessages(
  sessionId: string,
  requestSequence?: number
): Promise<ActionResult<boolean>> {
  try {
    const { SessionManager } = await import("@/lib/session-manager");

    // 如果指定了序号，检查特定请求
    if (requestSequence !== undefined) {
      const messages = await SessionManager.getSessionMessages(sessionId, requestSequence);
      return {
        ok: true,
        data: messages !== null,
      };
    }

    // 否则检查 Session 是否有任意请求的 messages
    const hasAny = await SessionManager.hasAnySessionMessages(sessionId);
    return {
      ok: true,
      data: hasAny,
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
 * 获取 Session 详情（包括 messages 和 response）
 *
 * 功能：获取指定 Session 的消息内容和响应数据
 * 权限：管理员可查看所有 Session，普通用户只能查看自己的 Session
 *
 * @param sessionId - Session ID
 * @param requestSequence - 请求序号（可选，用于获取 Session 内特定请求的消息）
 *
 * 安全修复：添加用户权限检查
 */
export async function getSessionDetails(
  sessionId: string,
  requestSequence?: number
): Promise<
  ActionResult<{
    messages: unknown | null;
    response: string | null;
    sessionStats: Awaited<
      ReturnType<typeof import("@/repository/message").aggregateSessionStats>
    > | null;
    currentSequence: number | null;
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
    const [messages, response, requestCount] = await Promise.all([
      SessionManager.getSessionMessages(sessionId, requestSequence),
      SessionManager.getSessionResponse(sessionId, requestSequence),
      SessionManager.getSessionRequestCount(sessionId),
    ]);

    return {
      ok: true,
      data: {
        messages,
        response,
        sessionStats,
        currentSequence: requestSequence ?? (requestCount > 0 ? requestCount : null),
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

/**
 * 获取 Session 内的所有请求列表（分页）
 *
 * 功能：获取指定 Session 中的所有请求记录，用于 Session 详情页的请求列表侧边栏
 * 权限：管理员可查看所有 Session，普通用户只能查看自己的 Session
 *
 * @param sessionId - Session ID
 * @param page - 页码（从 1 开始）
 * @param pageSize - 每页数量（默认 20）
 */
export async function getSessionRequests(
  sessionId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<
  ActionResult<{
    requests: Array<{
      id: number;
      sequence: number;
      model: string | null;
      statusCode: number | null;
      costUsd: string | null;
      createdAt: Date | null;
      inputTokens: number | null;
      outputTokens: number | null;
      errorMessage: string | null;
    }>;
    total: number;
    hasMore: boolean;
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

    // 1. 验证 Session 所有权
    const { aggregateSessionStats } = await import("@/repository/message");
    const sessionStats = await aggregateSessionStats(sessionId);

    if (!sessionStats) {
      return {
        ok: false,
        error: "Session 不存在",
      };
    }

    if (!isAdmin && sessionStats.userId !== currentUserId) {
      logger.warn(
        `[Security] User ${currentUserId} attempted to access session requests ${sessionId} owned by user ${sessionStats.userId}`
      );
      return {
        ok: false,
        error: "无权访问该 Session",
      };
    }

    // 2. 查询请求列表
    const { findRequestsBySessionId } = await import("@/repository/message");
    const offset = (page - 1) * pageSize;
    const { requests, total } = await findRequestsBySessionId(sessionId, {
      limit: pageSize,
      offset,
    });

    return {
      ok: true,
      data: {
        requests,
        total,
        hasMore: offset + requests.length < total,
      },
    };
  } catch (error) {
    logger.error("Failed to get session requests:", error);
    return {
      ok: false,
      error: "获取 Session 请求列表失败",
    };
  }
}

/**
 * 终止活跃 Session（主动打断）
 *
 * 功能：删除 Session 的 Redis 绑定关系，强制下次请求重新选择供应商
 * 权限：管理员可终止所有 Session，普通用户只能终止自己的 Session
 *
 * @param sessionId - Session ID
 */
export async function terminateActiveSession(sessionId: string): Promise<ActionResult<void>> {
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
        error: "Session 不存在或已过期",
      };
    }

    // 2. 权限检查：管理员可终止所有，普通用户只能终止自己的
    if (!isAdmin && sessionStats.userId !== currentUserId) {
      logger.warn(
        `[Security] User ${currentUserId} attempted to terminate session ${sessionId} owned by user ${sessionStats.userId}`
      );
      return {
        ok: false,
        error: "无权终止该 Session",
      };
    }

    // 3. 终止 Session
    const { SessionManager } = await import("@/lib/session-manager");
    const success = await SessionManager.terminateSession(sessionId);

    if (!success) {
      return {
        ok: false,
        error: "终止 Session 失败（Redis 不可用或 Session 已过期）",
      };
    }

    // 4. 清除缓存
    const { clearActiveSessionsCache, clearSessionDetailsCache, clearAllSessionsCache } =
      await import("@/lib/cache/session-cache");

    clearActiveSessionsCache();
    clearSessionDetailsCache(sessionId);
    clearAllSessionsCache();

    logger.info("Session terminated by user", {
      sessionId,
      terminatedByUserId: currentUserId,
      sessionOwnerUserId: sessionStats.userId,
      isAdmin,
    });

    return {
      ok: true,
      data: undefined,
    };
  } catch (error) {
    logger.error("Failed to terminate active session:", error);
    return {
      ok: false,
      error: "终止 Session 失败",
    };
  }
}

/**
 * 批量终止活跃 Session
 *
 * @param sessionIds - Session ID 列表
 */
type BatchTerminationActionResult = {
  successCount: number;
  failedCount: number;
  allowedFailedCount: number;
  unauthorizedCount: number;
  missingCount: number;
  requestedCount: number;
  processedCount: number;
  unauthorizedSessionIds: string[];
  missingSessionIds: string[];
};

export async function terminateActiveSessionsBatch(
  sessionIds: string[]
): Promise<ActionResult<BatchTerminationActionResult>> {
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

    const uniqueSessionIds = Array.from(new Set(sessionIds));

    if (uniqueSessionIds.length === 0) {
      return {
        ok: true,
        data: {
          successCount: 0,
          failedCount: 0,
          allowedFailedCount: 0,
          unauthorizedCount: 0,
          missingCount: 0,
          unauthorizedSessionIds: [],
          missingSessionIds: [],
          requestedCount: 0,
          processedCount: 0,
        },
      };
    }

    // 1. 验证每个 Session 的所有权
    const { aggregateMultipleSessionStats } = await import("@/repository/message");
    const sessionsData = await aggregateMultipleSessionStats(uniqueSessionIds);

    const { uniqueRequestedIds, allowedSessionIds, unauthorizedSessionIds, missingSessionIds } =
      summarizeTerminateSessionsBatch(uniqueSessionIds, sessionsData, currentUserId, isAdmin);

    const unauthorizedCount = unauthorizedSessionIds.length;
    const missingCount = missingSessionIds.length;

    const buildResult = (
      params: { successCount?: number; processedCount?: number } = {}
    ): BatchTerminationActionResult => {
      const successCountValue = params.successCount ?? 0;
      const processedCountValue = params.processedCount ?? 0;

      // 输入验证：确保参数为有效数字
      if (!Number.isFinite(successCountValue) || successCountValue < 0) {
        logger.error("Invalid successCount in buildResult", {
          successCount: successCountValue,
        });
        throw new Error("Invalid successCount: must be a non-negative finite number");
      }
      if (!Number.isFinite(processedCountValue) || processedCountValue < 0) {
        logger.error("Invalid processedCount in buildResult", {
          processedCount: processedCountValue,
        });
        throw new Error("Invalid processedCount: must be a non-negative finite number");
      }

      const allowedFailedCount = Math.max(processedCountValue - successCountValue, 0);

      return {
        successCount: successCountValue,
        failedCount: allowedFailedCount + unauthorizedCount + missingCount,
        allowedFailedCount,
        unauthorizedCount,
        missingCount,
        unauthorizedSessionIds,
        missingSessionIds,
        requestedCount: uniqueRequestedIds.length,
        processedCount: processedCountValue,
      };
    };

    if (allowedSessionIds.length === 0) {
      const summary = buildResult();
      logger.info("Batch session termination skipped (no authorized sessions)", {
        requested: summary.requestedCount,
        unauthorized: summary.unauthorizedCount,
        missing: summary.missingCount,
        terminatedByUserId: currentUserId,
        isAdmin,
      });

      return {
        ok: true,
        data: summary,
      };
    }

    // 3. 批量终止
    const { SessionManager } = await import("@/lib/session-manager");
    const successCount = await SessionManager.terminateSessionsBatch(allowedSessionIds);
    const processedCount = allowedSessionIds.length;
    const allowedFailedCount = Math.max(processedCount - successCount, 0);
    const failedCount = allowedFailedCount + unauthorizedCount + missingCount;

    // 4. 清除缓存
    const { clearActiveSessionsCache, clearAllSessionsCache, clearSessionDetailsCache } =
      await import("@/lib/cache/session-cache");

    clearActiveSessionsCache();
    clearAllSessionsCache();

    // 清除每个终止 Session 的详情缓存
    for (const sid of allowedSessionIds) {
      clearSessionDetailsCache(sid);
    }

    logger.info("Sessions terminated in batch", {
      total: sessionIds.length,
      requested: uniqueRequestedIds.length,
      allowed: allowedSessionIds.length,
      unauthorized: unauthorizedSessionIds.length,
      missing: missingSessionIds.length,
      successCount,
      failedCount,
      terminatedByUserId: currentUserId,
      isAdmin,
    });

    return {
      ok: true,
      data: buildResult({ successCount, processedCount }),
    };
  } catch (error) {
    logger.error("Failed to terminate active sessions batch:", error);
    return {
      ok: false,
      error: "批量终止 Session 失败",
    };
  }
}
