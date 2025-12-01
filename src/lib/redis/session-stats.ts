import { logger } from "@/lib/logger";
import { SessionTracker } from "@/lib/session-tracker";

/**
 * 获取当前活跃的并发 session 数量
 *
 * 使用 SessionTracker 的统一计数逻辑：
 * 1. 自动兼容新旧格式（ZSET/Set）
 * 2. ZREMRANGEBYSCORE 清理过期 session（5 分钟前）
 * 3. 批量 EXISTS 验证 session:${sessionId}:info 是否存在
 * 4. 返回真实有效的 session 数量
 *
 * @returns 当前并发 session 数量（Redis 不可用时返回 0）
 */
export async function getActiveConcurrentSessions(): Promise<number> {
  try {
    return await SessionTracker.getGlobalSessionCount();
  } catch (error) {
    logger.error("[SessionStats] Failed to get concurrent sessions:", error);
    return 0; // Fail Open
  }
}
