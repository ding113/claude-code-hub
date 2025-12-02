import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import type { ProxySession } from "./session";

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

      // 5. 追踪 session（添加到活跃集合）
      void SessionTracker.trackSession(sessionId, keyId).catch((err) => {
        logger.error("[ProxySessionGuard] Failed to track session:", err);
      });

      // 6. 存储 session 详细信息到 Redis（用于实时监控）
      void (async () => {
        try {
          if (session.authState?.user && session.authState?.key) {
            await SessionManager.storeSessionInfo(sessionId, {
              userName: session.authState.user.name,
              userId: session.authState.user.id,
              keyId: session.authState.key.id,
              keyName: session.authState.key.name,
              model: session.request.model,
              apiType: session.originalFormat === "openai" ? "codex" : "chat",
            });

            // 可选：存储 messages（受环境变量控制）
            const messages = session.getMessages();
            if (messages) {
              await SessionManager.storeSessionMessages(sessionId, messages);
            }
          }
        } catch (error) {
          logger.error("[ProxySessionGuard] Failed to store session info:", error);
        }
      })();

      logger.debug(
        `[ProxySessionGuard] Session assigned: ${sessionId} (key=${keyId}, messagesLength=${session.getMessagesLength()}, clientProvided=${!!clientSessionId})`
      );
    } catch (error) {
      logger.error("[ProxySessionGuard] Failed to assign session:", error);
      // 降级：生成新 session（不阻塞请求）
      const fallbackSessionId = SessionManager.generateSessionId();
      session.setSessionId(fallbackSessionId);
    }
  }
}
