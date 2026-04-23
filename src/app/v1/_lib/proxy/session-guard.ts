import { injectClaudeMetadataUserIdWithContext } from "@/lib/claude-code/metadata-user-id";
import { getCachedSystemSettings } from "@/lib/config";
import { logger } from "@/lib/logger";
import { resolveKeyUserConcurrentSessionLimits } from "@/lib/rate-limit/concurrent-session-limit";
import { headersToSanitizedObject, SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import { completeCodexSessionIdentifiers } from "../codex/session-completer";
import type { ProxySession } from "./session";

const CLIENT_HEADER_SNAPSHOT_BLOCKLIST = [
  /^cf-/i,
  /^x-forwarded-/i,
  /^x-real-ip$/i,
  /^true-client-ip$/i,
  /^forwarded$/i,
  /^traceparent$/i,
  /^tracestate$/i,
  /^baggage$/i,
  /^x-b3-/i,
  /^x-amzn-trace-id$/i,
];

function filterClientRequestSnapshotHeaders(headers: Headers): Record<string, string> | null {
  const sanitized = headersToSanitizedObject(headers);
  const filtered = Object.fromEntries(
    Object.entries(sanitized).filter(
      ([name]) => !CLIENT_HEADER_SNAPSHOT_BLOCKLIST.some((pattern) => pattern.test(name))
    )
  );

  return Object.keys(filtered).length > 0 ? filtered : null;
}

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
      const systemSettings = await getCachedSystemSettings();
      const rawFallbackEnabled =
        (systemSettings.allowNonConversationEndpointProviderFallback ?? true) &&
        session.getEndpointPolicy().allowRawCrossProviderFallback;
      (
        session as ProxySession & {
          setRawCrossProviderFallbackEnabled?: ((enabled: boolean) => void) | undefined;
        }
      ).setRawCrossProviderFallbackEnabled?.(rawFallbackEnabled);
      const allowRawSessionContext =
        typeof (
          session as ProxySession & {
            isRawCrossProviderFallbackEnabled?: (() => boolean) | undefined;
          }
        ).isRawCrossProviderFallbackEnabled === "function"
          ? session.isRawCrossProviderFallbackEnabled()
          : rawFallbackEnabled;
      session.setHighConcurrencyModeEnabled(systemSettings.enableHighConcurrencyMode ?? false);
      let requestMessageBeforeProxyMutations = session.request.message as Record<string, unknown>;
      if (session.request.message && typeof session.request.message === "object") {
        try {
          requestMessageBeforeProxyMutations = structuredClone(
            session.request.message as Record<string, unknown>
          );
        } catch {
          requestMessageBeforeProxyMutations = session.request.message as Record<string, unknown>;
        }
      }
      const originalMessages = session.getMessages();

      // Codex Session ID 补全：在提取 clientSessionId 之前触发，避免落入不稳定的降级方案
      const codexCompletionEnabled = systemSettings.enableCodexSessionIdCompletion ?? true;
      const claudeMetadataCompletionEnabled =
        systemSettings.enableClaudeMetadataUserIdInjection ?? true;
      const requestMessage = session.request.message as Record<string, unknown>;
      const isCodexRequest = Array.isArray(requestMessage.input);

      if (!allowRawSessionContext && codexCompletionEnabled && isCodexRequest) {
        const completion = await completeCodexSessionIdentifiers({
          keyId,
          headers: session.headers,
          requestBody: requestMessage,
          userAgent: session.userAgent,
        });

        if (completion.applied && completion.action !== "none") {
          session.addSpecialSetting({
            type: "codex_session_id_completion",
            scope: "request",
            hit: true,
            action: completion.action,
            source: completion.source,
            sessionId: completion.sessionId,
          });
        }
      }

      const warmupMaybeIntercepted =
        session.isWarmupRequest() &&
        !!session.authState?.success &&
        !!session.authState.user &&
        !!session.authState.key &&
        !!session.authState.apiKey &&
        systemSettings.interceptAnthropicWarmupRequests;

      // 1. 尝试从客户端提取 session_id（兼容 metadata.user_id / metadata.session_id）
      const clientSessionId = SessionManager.extractClientSessionId(
        session.request.message,
        session.headers,
        session.userAgent
      );

      // 2. 获取 messages 数组
      const messages = session.getMessages();

      // 3. 获取或创建 session_id
      const sessionId = await SessionManager.getOrCreateSessionId(keyId, messages, clientSessionId);

      // 4. 设置到 session 对象
      session.setSessionId(sessionId);

      if (
        !allowRawSessionContext &&
        claudeMetadataCompletionEnabled &&
        !warmupMaybeIntercepted &&
        session.originalFormat === "claude" &&
        !isCodexRequest
      ) {
        const completedMessage = injectClaudeMetadataUserIdWithContext(
          session.request.message as Record<string, unknown>,
          {
            keyId,
            sessionId,
            userAgent: session.userAgent,
          }
        );

        if (completedMessage !== session.request.message) {
          session.request.message = completedMessage;
        }
      }

      // 4.1 获取并设置请求序号（Session 内唯一标识每个请求）
      const requestSequence = await SessionManager.getNextRequestSequence(sessionId);
      session.setRequestSequence(requestSequence);

      // 4.2 存储完整请求体与客户端端点（用于 Session 详情调试）
      // 注意：必须在后续任何格式转换/过滤前触发存储，避免记录被“后处理”污染
      if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
        const requestBeforeSnapshot = {
          body: requestMessageBeforeProxyMutations,
          headers: filterClientRequestSnapshotHeaders(session.headers),
          meta: {
            clientUrl: session.requestUrl.toString(),
            upstreamUrl: null,
            method: session.method,
          },
          ...(originalMessages !== undefined ? { messages: originalMessages } : {}),
        };

        void SessionManager.storeSessionRequestBody(
          session.sessionId,
          session.request.message,
          requestSequence
        ).catch((err) => {
          logger.error("[ProxySessionGuard] Failed to store session request body:", err);
        });

        void SessionManager.storeSessionClientRequestMeta(
          session.sessionId,
          { url: session.requestUrl, method: session.method },
          requestSequence
        ).catch((err) => {
          logger.error("[ProxySessionGuard] Failed to store client request meta:", err);
        });

        // 新增 before-phase 快照，明确记录客户端原始输入，后续 UI 不再依赖混合时机字段猜语义。
        const requestBeforeSnapshotTask = SessionManager.storeSessionRequestPhaseSnapshot?.(
          session.sessionId,
          "before",
          requestBeforeSnapshot,
          requestSequence
        );
        requestBeforeSnapshotTask?.catch((err) => {
          logger.error("[ProxySessionGuard] Failed to store request before snapshot:", err);
        });

        // 可选：存储 messages（受环境变量控制，按请求序号独立存储）
        if (messages !== undefined) {
          void SessionManager.storeSessionMessages(
            session.sessionId,
            messages,
            requestSequence
          ).catch((err) => {
            logger.error("[ProxySessionGuard] Failed to store session messages:", err);
          });
        }
      }

      // 5. 追踪 session（添加到活跃集合）
      // Warmup 拦截请求不应计入并发会话（避免影响后续真实请求的限额判断）
      // 注意：当启用 Key/User 并发 Session 上限时，必须在 RateLimitGuard 中做“原子性检查+追踪”。
      // 否则先追踪再检查会导致所有新 session 都被视为“已追踪”，从而击穿并发上限。
      const { enabled: hasConcurrentSessionLimit } = resolveKeyUserConcurrentSessionLimits(
        session.authState?.key?.limitConcurrentSessions,
        session.authState?.user?.limitConcurrentSessions
      );

      if (
        !warmupMaybeIntercepted &&
        !hasConcurrentSessionLimit &&
        session.shouldTrackSessionObservability()
      ) {
        void SessionTracker.trackSession(sessionId, keyId, session.authState?.user?.id).catch(
          (err) => {
            logger.error("[ProxySessionGuard] Failed to track session:", err);
          }
        );
      }

      // 6. 存储 session 详细信息到 Redis（用于实时监控，带重试机制）
      if (session.shouldTrackSessionObservability()) {
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
            }
          } catch (error) {
            // 重试后仍然失败，记录错误但不阻塞请求
            logger.error("[ProxySessionGuard] Failed to store session info after retries:", error);
          }
        })();
      }

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
