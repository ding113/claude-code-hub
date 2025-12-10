import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import type { ProxySession } from "./session";

/**
 * 带重试的异步操作执行器
 * @param fn - 要执行的异步函数
 * @param maxRetries - 最大重试次数（默认 2 次）
 * @param delayMs - 重试间隔基数（毫秒，默认 100ms）
 */
async function executeWithRetry(
  fn: () => Promise<void>,
  maxRetries = 2,
  delayMs = 100
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      // 指数退避：100ms, 200ms, 400ms...
      const delay = delayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Session 守卫：负责为请求分配 Session ID
 *
 * 调用时机：在认证成功后、限流检查前
 */
export class ProxySessionGuard {
  /**
   * 为请求分配 Session ID
   */
  static async ensure(session: ProxySession): Promise<void> {
    const keyId = session.authState?.key?.id;
    if (!keyId) {
      logger.warn("[ProxySessionGuard] No key ID, skipping session assignment");
      return;
    }

    try {
      // 1. 尝试从客户端提取 session_id（metadata.session_id）
      const clientSessionId =
        SessionManager.extractClientSessionId(session.request.message) ||
        session.generateDeterministicSessionId();

      // 2. 获取 messages 数组
      const messages = session.getMessages();

      // 3. 获取或创建 session_id
      const sessionId = await SessionManager.getOrCreateSessionId(keyId, messages, clientSessionId);

      // 4. 设置到 session 对象
      session.setSessionId(sessionId);

      // 4.1 获取并设置请求序号（Session 内唯一标识每个请求）
      const requestSequence = await SessionManager.getNextRequestSequence(sessionId);
      session.setRequestSequence(requestSequence);

      // 5. 追踪 session（添加到活跃集合）
      void SessionTracker.trackSession(sessionId, keyId).catch((err) => {
        logger.error("[ProxySessionGuard] Failed to track session:", err);
      });

      // 6. 存储 session 详细信息到 Redis（用于实时监控，带重试机制）
      void (async () => {
        try {
          if (session.authState?.user && session.authState?.key) {
            // 存储 session info（带重试）
            await executeWithRetry(async () => {
              await SessionManager.storeSessionInfo(sessionId, {
                userName: session.authState!.user!.name,
                userId: session.authState!.user!.id,
                keyId: session.authState!.key!.id,
                keyName: session.authState!.key!.name,
                model: session.request.model,
                apiType: session.originalFormat === "openai" ? "codex" : "chat",
              });
            });

            // 可选：存储 messages（受环境变量控制，按请求序号独立存储，带重试）
            const messages = session.getMessages();
            if (messages) {
              await executeWithRetry(async () => {
                await SessionManager.storeSessionMessages(sessionId, messages, requestSequence);
              });
            }
          }
        } catch (error) {
          // 重试后仍然失败，记录错误但不阻塞请求
          logger.error("[ProxySessionGuard] Failed to store session info after retries:", error);
        }
      })();

      logger.debug(
        `[ProxySessionGuard] Session assigned: ${sessionId}:${requestSequence} (key=${keyId}, messagesLength=${session.getMessagesLength()}, clientProvided=${!!clientSessionId})`
      );
    } catch (error) {
      logger.error("[ProxySessionGuard] Failed to assign session:", error);
      // 降级：生成新 session（不阻塞请求）
      const fallbackSessionId = SessionManager.generateSessionId();
      session.setSessionId(fallbackSessionId);
    }
  }
}
