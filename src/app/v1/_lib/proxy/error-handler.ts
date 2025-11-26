import { updateMessageRequestDuration, updateMessageRequestDetails } from "@/repository/message";
import { logger } from "@/lib/logger";
import { ProxyResponses } from "./responses";
import { ProxyError, RateLimitError, isRateLimitError } from "./errors";
import type { ProxySession } from "./session";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";

export class ProxyErrorHandler {
  static async handle(session: ProxySession, error: unknown): Promise<Response> {
    let errorMessage: string;
    let statusCode = 500;
    let rateLimitMetadata: Record<string, unknown> | null = null;

    // 优先处理 RateLimitError（新增）
    if (isRateLimitError(error)) {
      errorMessage = error.message;
      statusCode = 429;
      rateLimitMetadata = error.toJSON();

      // 构建详细的 429 响应
      const response = this.buildRateLimitResponse(error);

      // 记录错误到数据库（包含 rate_limit 元数据）
      await this.logErrorToDatabase(session, errorMessage, statusCode, rateLimitMetadata);

      return response;
    }

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

    // 记录错误到数据库
    await this.logErrorToDatabase(session, errorMessage, statusCode, null);

    logger.error("ProxyErrorHandler: Request failed", {
      error: errorMessage,
      statusCode,
    });

    return ProxyResponses.buildError(statusCode, errorMessage);
  }

  /**
   * 构建 429 Rate Limit 响应
   *
   * 返回包含所有 7 个限流字段的详细错误信息，并添加标准 rate limit 响应头
   *
   * 响应体字段（7个核心字段）：
   * - error.type: "rate_limit_error"
   * - error.message: 人类可读的错误消息
   * - error.code: 错误代码（固定为 "rate_limit_exceeded"）
   * - error.limit_type: 限流类型（rpm/usd_5h/usd_weekly/usd_monthly/concurrent_sessions/daily_quota）
   * - error.current: 当前使用量
   * - error.limit: 限制值
   * - error.reset_time: 重置时间（ISO-8601格式）
   *
   * 响应头（3个标准 rate limit 头）：
   * - X-RateLimit-Limit: 限制值
   * - X-RateLimit-Remaining: 剩余配额（max(0, limit - current)）
   * - X-RateLimit-Reset: Unix 时间戳（秒）
   */
  private static buildRateLimitResponse(error: RateLimitError): Response {
    // 计算剩余配额（不能为负数）
    const remaining = Math.max(0, error.limitValue - error.currentUsage);

    // 计算 Unix 时间戳（秒）
    const resetTimestamp = Math.floor(new Date(error.resetTime).getTime() / 1000);

    const headers = new Headers({
      "Content-Type": "application/json",
      // 标准 rate limit 响应头（3个）
      "X-RateLimit-Limit": error.limitValue.toString(),
      "X-RateLimit-Remaining": remaining.toString(),
      "X-RateLimit-Reset": resetTimestamp.toString(),
      // 额外的自定义头（便于客户端快速识别限流类型）
      "X-RateLimit-Type": error.limitType,
      "Retry-After": this.calculateRetryAfter(error.resetTime),
    });

    return new Response(
      JSON.stringify({
        error: {
          // 保持向后兼容的核心字段
          type: error.type,
          message: error.message,
          // 新增字段（按任务要求的7个字段）
          code: "rate_limit_exceeded",
          limit_type: error.limitType,
          current: error.currentUsage,
          limit: error.limitValue,
          reset_time: error.resetTime,
        },
      }),
      {
        status: 429,
        headers,
      }
    );
  }

  /**
   * 计算 Retry-After 头（秒数）
   */
  private static calculateRetryAfter(resetTime: string): string {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const secondsUntilReset = Math.max(0, Math.ceil((resetDate.getTime() - now.getTime()) / 1000));
    return secondsUntilReset.toString();
  }

  /**
   * 记录错误到数据库
   *
   * 如果提供了 rateLimitMetadata，将其 JSON 序列化后存入 errorMessage
   * 供应商决策链保持不变，存入 providerChain 字段
   */
  private static async logErrorToDatabase(
    session: ProxySession,
    errorMessage: string,
    statusCode: number,
    rateLimitMetadata: Record<string, unknown> | null
  ): Promise<void> {
    if (!session.messageContext) {
      return;
    }

    const duration = Date.now() - session.startTime;
    await updateMessageRequestDuration(session.messageContext.id, duration);

    // 如果是限流错误，将元数据附加到错误消息中
    let finalErrorMessage = errorMessage;
    if (rateLimitMetadata) {
      finalErrorMessage = `${errorMessage} | rate_limit_metadata: ${JSON.stringify(rateLimitMetadata)}`;
    }

    // 保存错误信息和决策链
    await updateMessageRequestDetails(session.messageContext.id, {
      errorMessage: finalErrorMessage,
      providerChain: session.getProviderChain(),
      statusCode: statusCode,
      model: session.getCurrentModel() ?? undefined,
      providerId: session.provider?.id, // ⭐ 更新最终供应商ID（重试切换后）
    });

    // 记录请求结束
    const tracker = ProxyStatusTracker.getInstance();
    tracker.endRequest(session.messageContext.user.id, session.messageContext.id);
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
