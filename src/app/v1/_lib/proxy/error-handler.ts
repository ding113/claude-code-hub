import { updateMessageRequestDuration, updateMessageRequestDetails } from "@/repository/message";
import { logger } from "@/lib/logger";
import { ProxyResponses } from "./responses";
import { ProxyError } from "./errors";
import type { ProxySession } from "./session";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";

export class ProxyErrorHandler {
  static async handle(session: ProxySession, error: unknown): Promise<Response> {
    let errorMessage: string;
    let statusCode = 500;

    // 识别 ProxyError，提取详细信息（包含上游响应）
    if (error instanceof ProxyError) {
      errorMessage = error.getDetailedErrorMessage();
      statusCode = error.statusCode; // 使用实际状态码（不再统一 5xx 为 500）
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "代理请求发生未知错误";
    }

    // 后备方案：如果状态码仍是 500，尝试从 provider chain 中提取最后一次实际请求的状态码
    if (statusCode === 500) {
      const lastRequestStatusCode = this.getLastRequestStatusCode(session);
      if (lastRequestStatusCode && lastRequestStatusCode !== 200) {
        statusCode = lastRequestStatusCode;
      }
    }

    if (session.messageContext) {
      const duration = Date.now() - session.startTime;
      await updateMessageRequestDuration(session.messageContext.id, duration);

      // 保存错误信息和决策链（现在包含完整上游错误）
      await updateMessageRequestDetails(session.messageContext.id, {
        errorMessage: errorMessage,
        providerChain: session.getProviderChain(),
        statusCode: statusCode,
      });

      // 记录请求结束
      const tracker = ProxyStatusTracker.getInstance();
      tracker.endRequest(session.messageContext.user.id, session.messageContext.id);
    }

    logger.error("ProxyErrorHandler: Request failed", {
      error: errorMessage,
      statusCode,
    });

    return ProxyResponses.buildError(statusCode, errorMessage);
  }

  /**
   * 从 provider chain 中提取最后一次实际请求的状态码
   */
  private static getLastRequestStatusCode(session: ProxySession): number | null {
    const chain = session.getProviderChain();
    if (!chain || chain.length === 0) {
      return null;
    }

    // 从后往前遍历，找到第一个有 statusCode 的记录（retry_failed 或 request_success）
    for (let i = chain.length - 1; i >= 0; i--) {
      const item = chain[i];
      if (item.statusCode && item.statusCode !== 200) {
        // 找到了失败的请求状态码
        return item.statusCode;
      }
    }

    return null;
  }
}
