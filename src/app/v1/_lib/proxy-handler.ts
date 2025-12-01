import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { SessionTracker } from "@/lib/session-tracker";
import { ProxyErrorHandler } from "./proxy/error-handler";
import { detectClientFormat, detectFormatByEndpoint } from "./proxy/format-mapper";
import { ProxyForwarder } from "./proxy/forwarder";
import { GuardPipelineBuilder, RequestType } from "./proxy/guard-pipeline";
import { ProxyResponseHandler } from "./proxy/response-handler";
import { ProxySession } from "./proxy/session";

export async function handleProxyRequest(c: Context): Promise<Response> {
  const session = await ProxySession.fromContext(c);

  try {
    // 自动检测请求格式（端点优先，请求体补充）
    if (session.originalFormat === "claude") {
      // 第一步：尝试端点检测（优先级最高，最准确）
      const endpointFormat = detectFormatByEndpoint(session.requestUrl.pathname);

      if (endpointFormat) {
        session.setOriginalFormat(endpointFormat);
        logger.debug("[ProxyHandler] Detected format by endpoint", {
          endpoint: session.requestUrl.pathname,
          format: endpointFormat,
        });
      } else {
        // 第二步：降级到请求体检测（作为 fallback）
        const detectedFormat = detectClientFormat(
          session.request.message as Record<string, unknown>
        );
        session.setOriginalFormat(detectedFormat);

        if (detectedFormat !== "claude") {
          logger.debug("[ProxyHandler] Detected format by request body (endpoint unknown)", {
            format: detectedFormat,
            endpoint: session.requestUrl.pathname,
            hasContents: Array.isArray(
              (session.request.message as Record<string, unknown>).contents
            ),
            hasRequest:
              typeof (session.request.message as Record<string, unknown>).request === "object",
          });
        }
      }
    }

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
