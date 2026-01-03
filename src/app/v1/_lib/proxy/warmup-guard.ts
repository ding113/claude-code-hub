import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getCachedSystemSettings } from "@/lib/config";
import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import type { ProxySession } from "./session";
import {
  buildClaudeWarmupInterceptResponse,
  getClaudeStreamFlag,
  isClaudeWarmupRequestBody,
  WARMUP_BLOCKED_BY,
} from "./warmup-intercept";

export class ProxyWarmupGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    // 仅对 Claude/Anthropic 格式启用（“只针对 Anthropic 类型”的落地口径）
    if (session.originalFormat !== "claude") {
      return null;
    }

    const settings = await getCachedSystemSettings();
    if (!settings.enableAnthropicWarmupIntercept) {
      return null;
    }

    if (!isClaudeWarmupRequestBody(session.request.message)) {
      return null;
    }

    const acceptHeader = session.headers.get("accept");
    const stream = getClaudeStreamFlag(session.request.message, acceptHeader);
    const model = session.request.model ?? "unknown";

    const { response, responseBodyForStore, responseHeaders } = buildClaudeWarmupInterceptResponse({
      model,
      stream,
    });

    // 1) 存储响应体/头，确保 Session 详情可回放（即使不存 messages 也能看到 response）
    if (session.sessionId) {
      void SessionManager.storeSessionResponse(
        session.sessionId,
        responseBodyForStore,
        session.requestSequence
      ).catch((err) => {
        logger.error("[WarmupGuard] Failed to store session response", { err });
      });

      void SessionManager.storeSessionResponseHeaders(
        session.sessionId,
        responseHeaders,
        session.requestSequence
      ).catch((err) => {
        logger.error("[WarmupGuard] Failed to store session response headers", { err });
      });

      void SessionManager.storeSessionRequestHeaders(
        session.sessionId,
        session.headers,
        session.requestSequence
      ).catch((err) => {
        logger.error("[WarmupGuard] Failed to store session request headers", { err });
      });
    }

    // 2) 写入请求日志（不计费、不绑定 provider），但可审计可检索
    try {
      if (
        session.authState?.success &&
        session.authState.user &&
        session.authState.apiKey &&
        session.sessionId
      ) {
        await db.insert(messageRequest).values({
          providerId: 0, // 特殊值：表示未选择供应商（本地抢答）
          userId: session.authState.user.id,
          key: session.authState.apiKey,
          model: session.request.model ?? undefined,
          sessionId: session.sessionId,
          requestSequence: session.getRequestSequence(),
          endpoint: session.getEndpoint() ?? undefined,
          statusCode: 200,
          durationMs: Math.max(0, Date.now() - session.startTime),
          costUsd: "0", // 明确不计费
          blockedBy: WARMUP_BLOCKED_BY, // 复用“拦截信息”展示区（但语义为本地抢答）
          blockedReason: JSON.stringify({
            type: "anthropic_warmup",
            interceptedBy: "cch",
            skippedUpstream: true,
          }),
          userAgent: session.userAgent ?? undefined,
          messagesCount: session.getMessagesLength(),
        });
      }
    } catch (error) {
      // 失败不阻塞 warmup 抢答
      logger.error("[WarmupGuard] Failed to log warmup intercept request", { error });
    }

    return response;
  }
}
