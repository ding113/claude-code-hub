import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { ProxySession } from "./proxy/session";
import { GuardPipelineBuilder, RequestType } from "./proxy/guard-pipeline";
import { ProxyForwarder } from "./proxy/forwarder";
import { ProxyResponseHandler } from "./proxy/response-handler";
import { ProxyErrorHandler } from "./proxy/error-handler";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { SessionTracker } from "@/lib/session-tracker";

export async function handleProxyRequest(c: Context): Promise<Response> {
  const session = await ProxySession.fromContext(c);

  try {
    // Decide request type and build configured guard pipeline
    const type = session.isCountTokensRequest() ? RequestType.COUNT_TOKENS : RequestType.CHAT;
    const pipeline = GuardPipelineBuilder.fromRequestType(type);

    // Run guard chain; may return early Response
    const early = await pipeline.run(session);
    if (early) return early;

    // 9. 增加并发计数（在所有检查通过后，请求开始前）- 跳过 count_tokens
    if (session.sessionId && !session.isCountTokensRequest()) {
      await SessionTracker.incrementConcurrentCount(session.sessionId);
    }

    // 10. 记录请求开始
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
    // 11. 减少并发计数（确保无论成功失败都执行）- 跳过 count_tokens
    if (session.sessionId && !session.isCountTokensRequest()) {
      await SessionTracker.decrementConcurrentCount(session.sessionId);
    }
  }
}
