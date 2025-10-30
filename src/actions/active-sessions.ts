"use server";

import { SessionManager } from "@/lib/session-manager";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";
import type { ActiveSessionInfo } from "@/types/session";
import { getPrivacyContext } from "@/lib/utils/privacy-filter.server";

/**
 * 获取所有活跃 session 的详细信息（使用聚合数据）
 * 用于实时监控页面
 */
export async function getActiveSessions(): Promise<ActionResult<ActiveSessionInfo[]>> {
  try {
    // 1. 从 SessionTracker 获取活跃 session ID 列表
    const { SessionTracker } = await import("@/lib/session-tracker");
    const sessionIds = await SessionTracker.getActiveSessions();

    if (sessionIds.length === 0) {
      return { ok: true, data: [] };
    }

    // 获取隐私过滤上下文（决定金额计算方式）
    const privacyContext = await getPrivacyContext();

    // 2. 并行查询每个 session 的聚合数据
    const { aggregateSessionStats } = await import("@/repository/message");
    const sessionsData = await Promise.all(
      sessionIds.map((id) => aggregateSessionStats(id, privacyContext))
    );

    // 3. 过滤掉查询失败的 session，并转换格式
    const sessions: ActiveSessionInfo[] = sessionsData
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({
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
 */
export async function getAllSessions(): Promise<
  ActionResult<{
    active: ActiveSessionInfo[];
    inactive: ActiveSessionInfo[];
  }>
> {
  try {
    const sessions = await SessionManager.getAllSessionsWithExpiry();
    return {
      ok: true,
      data: sessions,
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
 */
export async function getSessionMessages(sessionId: string): Promise<ActionResult<unknown>> {
  try {
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
    // 获取隐私过滤上下文（决定金额计算方式）
    const privacyContext = await getPrivacyContext();

    // 并行获取三项数据：messages, response, 聚合统计
    const { aggregateSessionStats } = await import("@/repository/message");
    const [messages, response, sessionStats] = await Promise.all([
      SessionManager.getSessionMessages(sessionId),
      SessionManager.getSessionResponse(sessionId),
      aggregateSessionStats(sessionId, privacyContext),
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
