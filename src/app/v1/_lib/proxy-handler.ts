import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { ProxySession } from "./proxy/session";
import { ProxyAuthenticator } from "./proxy/auth-guard";
import { ProxySessionGuard } from "./proxy/session-guard";
import { ProxySensitiveWordGuard } from "./proxy/sensitive-word-guard";
import { ProxyRateLimitGuard } from "./proxy/rate-limit-guard";
import { ProxyProviderResolver } from "./proxy/provider-selector";
import { ProxyMessageService } from "./proxy/message-service";
import { ProxyForwarder } from "./proxy/forwarder";
import { ProxyResponseHandler } from "./proxy/response-handler";
import { ProxyErrorHandler } from "./proxy/error-handler";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { SessionTracker } from "@/lib/session-tracker";

export async function handleProxyRequest(c: Context): Promise<Response> {
  const session = await ProxySession.fromContext(c);

  try {
    // 1. 认证检查
    const unauthorized = await ProxyAuthenticator.ensure(session);
    if (unauthorized) {
      return unauthorized;
    }

    // 2. 探测请求拦截：立即返回，不执行任何后续逻辑
    if (session.isProbeRequest()) {
      logger.debug("[ProxyHandler] Probe request detected, returning mock success", {
        messagesCount: session.getMessagesLength(),
      });
      return new Response(JSON.stringify({ input_tokens: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Session 分配
    await ProxySessionGuard.ensure(session);

    // 4. 敏感词检查（在计费之前）
    const blockedBySensitiveWord = await ProxySensitiveWordGuard.ensure(session);
    if (blockedBySensitiveWord) {
      return blockedBySensitiveWord;
    }

    // 5. 限流检查
    const rateLimited = await ProxyRateLimitGuard.ensure(session);
    if (rateLimited) {
      return rateLimited;
    }

    // 6. 供应商选择
    const providerUnavailable = await ProxyProviderResolver.ensure(session);
    if (providerUnavailable) {
      return providerUnavailable;
    }

    // 7. 创建消息上下文（正常请求才写入数据库）
    await ProxyMessageService.ensureContext(session);

    // 8. 增加并发计数（在所有检查通过后，请求开始前）
    if (session.sessionId) {
      await SessionTracker.incrementConcurrentCount(session.sessionId);
    }

    // 9. 记录请求开始
    if (session.messageContext && session.provider) {
      const tracker = ProxyStatusTracker.getInstance();
      tracker.startRequest({
        userId: session.messageContext.user.id,
        userName: session.messageContext.user.name,
        requestId: session.messageContext.id,
        keyName: session.messageContext.key.name,
        providerId: session.provider.id,
        providerName: session.provider.name,
        model: session.request.model || "unknown",
      });
    }

    const response = await ProxyForwarder.send(session);
    return await ProxyResponseHandler.dispatch(session, response);
  } catch (error) {
    logger.error("Proxy handler error:", error);
    return await ProxyErrorHandler.handle(session, error);
  } finally {
    // 10. 减少并发计数（确保无论成功失败都执行）
    if (session.sessionId) {
      await SessionTracker.decrementConcurrentCount(session.sessionId);
    }
  }
}
