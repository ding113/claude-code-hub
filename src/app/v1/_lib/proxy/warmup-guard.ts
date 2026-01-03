import crypto from "node:crypto";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getCachedSystemSettings } from "@/lib/config";
import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import type { ProxySession } from "./session";

const WARMUP_UPSTREAM_META_URL = "/__cch__/warmup";

/**
 * Warmup 守卫（可选）
 *
 * 目标：
 * - 拦截 Anthropic /v1/messages 的 Warmup 请求
 * - 由 CCH 直接抢答最小合法响应，避免打到上游供应商
 * - 记录到请求日志，但不计费、不计入任何限额/统计
 *
 * 重要：
 * - 必须默认关闭（由系统设置开关控制）
 * - 仅在 rateLimit/provider 之前 early-return，确保不触发限流与供应商统计
 */
export class ProxyWarmupGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    // 快速路径：大多数请求不是 warmup
    if (!session.isWarmupRequest()) {
      return null;
    }

    const settings = await getCachedSystemSettings();
    if (!settings.interceptAnthropicWarmupRequests) {
      return null;
    }

    const authState = session.authState;
    if (!authState?.success || !authState.user || !authState.key || !authState.apiKey) {
      return null;
    }

    const responseBody = buildWarmupResponseBody(session.request.model);
    const responseText = JSON.stringify(responseBody);

    const responseHeaders = new Headers({
      "content-type": "application/json; charset=utf-8",
      // 标注：这是 CCH 抢答的响应（便于客户端/排查）
      "x-cch-intercepted": "warmup",
      "x-cch-intercepted-by": "claude-code-hub",
    });

    // 尽量把“本地抢答”的响应写入 Session 详情（用于排查/审计）
    if (session.sessionId) {
      const seq = session.getRequestSequence();
      await Promise.allSettled([
        SessionManager.storeSessionResponse(session.sessionId, responseText, seq),
        SessionManager.storeSessionResponseHeaders(session.sessionId, responseHeaders, seq),
        SessionManager.storeSessionUpstreamRequestMeta(
          session.sessionId,
          { url: WARMUP_UPSTREAM_META_URL, method: session.method },
          seq
        ),
        SessionManager.storeSessionUpstreamResponseMeta(
          session.sessionId,
          { url: WARMUP_UPSTREAM_META_URL, statusCode: 200 },
          seq
        ),
      ]);
    }

    // 写入请求日志（同步 await，保证审计一致性；失败也不影响响应）
    try {
      const durationMs = Date.now() - session.startTime;

      await db.insert(messageRequest).values({
        providerId: 0, // 特殊值：表示未请求上游供应商（CCH 抢答）
        userId: authState.user.id,
        key: authState.apiKey,
        model: session.request.model ?? undefined,
        originalModel: session.getOriginalModel() ?? undefined,
        sessionId: session.sessionId ?? undefined,
        requestSequence: session.getRequestSequence(),
        userAgent: session.userAgent ?? undefined,
        endpoint: session.getEndpoint() ?? undefined,
        messagesCount: session.getMessagesLength(),
        statusCode: 200,
        durationMs,
        ttfbMs: durationMs,
        // 不计费：显式写 NULL，避免前端误显示 “$0”
        costUsd: null,
        blockedBy: "warmup",
        blockedReason: JSON.stringify({
          reason: "anthropic_warmup_intercepted",
          note: "已由 CCH 抢答，未转发上游，不计费/不限流/不计入统计",
        }),
      });
    } catch (error) {
      logger.error("[WarmupGuard] Failed to log warmup request:", error);
    }

    logger.debug("[WarmupGuard] Intercepted warmup request", {
      sessionId: session.sessionId,
      requestSequence: session.getRequestSequence(),
      userId: authState.user.id,
      endpoint: session.getEndpoint(),
    });

    return new Response(responseText, { status: 200, headers: responseHeaders });
  }
}

function buildWarmupResponseBody(model: string | null): Record<string, unknown> {
  return {
    model: model ?? "unknown",
    id: `msg_cch_${crypto.randomBytes(8).toString("hex")}`,
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I'm ready to help you.",
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
