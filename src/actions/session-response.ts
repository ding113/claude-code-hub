"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";

/**
 * 获取 session 响应体内容
 *
 * @param sessionId - Session ID
 * @returns 响应体内容或错误信息
 *
 * 安全修复：添加用户权限检查
 */
export async function getSessionResponse(
  sessionId: string
): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
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
        `[Security] User ${currentUserId} attempted to access response of session ${sessionId} owned by user ${sessionStats.userId}`
      );
      return {
        ok: false,
        error: "无权访问该 Session",
      };
    }

    // 3. 获取响应体
    const response = await SessionManager.getSessionResponse(sessionId);

    if (!response) {
      return {
        ok: false,
        error: "响应体已过期（5分钟 TTL）或尚未记录",
      };
    }

    return { ok: true, data: response };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "获取响应体失败",
    };
  }
}
