import {
  isClaudeErrorFormat,
  isGeminiErrorFormat,
  isOpenAIErrorFormat,
  isValidErrorOverrideResponse,
} from "@/lib/error-override-validator";
import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { updateMessageRequestDetails, updateMessageRequestDuration } from "@/repository/message";
import { attachSessionIdToErrorResponse } from "./error-session-id";
import {
  getErrorOverrideAsync,
  isEmptyResponseError,
  isRateLimitError,
  ProxyError,
  type RateLimitError,
} from "./errors";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

/** 覆写状态码最小值 */
const OVERRIDE_STATUS_CODE_MIN = 400;
/** 覆写状态码最大值 */
const OVERRIDE_STATUS_CODE_MAX = 599;

/**
 * 根据限流类型计算 HTTP 状态码
 * - RPM/并发用 429 Too Many Requests（可重试的频率控制）
 * - 消费限额用 402 Payment Required（需充值/等待重置）
 */
function getRateLimitStatusCode(limitType: string): number {
  return limitType === "rpm" || limitType === "concurrent_sessions" ? 429 : 402;
}

export class ProxyErrorHandler {
  static async handle(session: ProxySession, error: unknown): Promise<Response> {
    // 分离两种消息：
    // - clientErrorMessage: 返回给客户端的安全消息（不含供应商名称）
    // - logErrorMessage: 记录到数据库的详细消息（包含供应商名称，便于排查）
    let clientErrorMessage: string;
    let logErrorMessage: string;
    let statusCode = 500;
    let rateLimitMetadata: Record<string, unknown> | null = null;

    // 优先处理 RateLimitError（新增）
    if (isRateLimitError(error)) {
      clientErrorMessage = error.message;
      logErrorMessage = error.message;
      // 使用 helper 函数计算状态码
      statusCode = getRateLimitStatusCode(error.limitType);
      rateLimitMetadata = error.toJSON();

      // 构建详细的 402 响应
      const response = ProxyErrorHandler.buildRateLimitResponse(error);

      // 记录错误到数据库（包含 rate_limit 元数据）
      await ProxyErrorHandler.logErrorToDatabase(
        session,
        logErrorMessage,
        statusCode,
        rateLimitMetadata
      );

      return await attachSessionIdToErrorResponse(session.sessionId, response);
    }

    // 识别 ProxyError，提取详细信息（包含上游响应）
    if (error instanceof ProxyError) {
      // 客户端消息：不含供应商名称，保护敏感信息
      clientErrorMessage = error.getClientSafeMessage();
      // 日志消息：包含供应商名称，便于问题排查
      logErrorMessage = error.getDetailedErrorMessage();
      statusCode = error.statusCode; // 使用实际状态码（不再统一 5xx 为 500）
    } else if (isEmptyResponseError(error)) {
      // EmptyResponseError: 客户端消息不含供应商名称
      clientErrorMessage = error.getClientSafeMessage();
      logErrorMessage = error.message; // 日志保留完整信息
      statusCode = 502; // Bad Gateway
    } else if (error instanceof Error) {
      clientErrorMessage = error.message;
      logErrorMessage = error.message;
    } else {
      clientErrorMessage = "代理请求发生未知错误";
      logErrorMessage = "代理请求发生未知错误";
    }

    // 后备方案：如果状态码仍是 500，尝试从 provider chain 中提取最后一次实际请求的状态码
    if (statusCode === 500) {
      const lastRequestStatusCode = ProxyErrorHandler.getLastRequestStatusCode(session);
      if (lastRequestStatusCode && lastRequestStatusCode !== 200) {
        statusCode = lastRequestStatusCode;
      }
    }

    // 记录错误到数据库（始终记录详细错误消息，包含供应商名称）
    await ProxyErrorHandler.logErrorToDatabase(session, logErrorMessage, statusCode, null);

    // 检测是否有覆写配置（响应体或状态码）
    // 使用异步版本确保错误规则已加载
    if (error instanceof Error) {
      const override = await getErrorOverrideAsync(error);
      if (override) {
        // 运行时校验覆写状态码范围（400-599），防止数据库脏数据导致 Response 抛 RangeError
        let validatedStatusCode = override.statusCode;
        if (
          validatedStatusCode !== null &&
          (!Number.isInteger(validatedStatusCode) ||
            validatedStatusCode < OVERRIDE_STATUS_CODE_MIN ||
            validatedStatusCode > OVERRIDE_STATUS_CODE_MAX)
        ) {
          logger.warn("ProxyErrorHandler: Invalid override status code, falling back to upstream", {
            overrideStatusCode: validatedStatusCode,
            upstreamStatusCode: statusCode,
          });
          validatedStatusCode = null;
        }

        // 使用覆写状态码，如果未配置或无效则使用上游状态码
        const responseStatusCode = validatedStatusCode ?? statusCode;

        // 提取上游 request_id（用于覆写场景透传）
        const upstreamRequestId =
          error instanceof ProxyError ? error.upstreamError?.requestId : undefined;
        const safeRequestId = typeof upstreamRequestId === "string" ? upstreamRequestId : undefined;

        // 情况 1: 有响应体覆写 - 返回覆写的 JSON 响应
        if (override.response) {
          // 运行时守卫：验证覆写响应格式是否合法（双重保护，加载时已过滤一次）
          // 防止数据库中存在畸形数据导致返回不合规响应
          if (!isValidErrorOverrideResponse(override.response)) {
            logger.warn("ProxyErrorHandler: Invalid override response in database, skipping", {
              response: JSON.stringify(override.response).substring(0, 200),
            });
            // 跳过响应体覆写，但仍可应用状态码覆写
            if (override.statusCode !== null) {
              return await attachSessionIdToErrorResponse(
                session.sessionId,
                ProxyResponses.buildError(
                  responseStatusCode,
                  clientErrorMessage,
                  undefined,
                  undefined,
                  safeRequestId
                )
              );
            }
            // 两者都无效，返回原始错误（但仍透传 request_id，因为有覆写意图）
            return await attachSessionIdToErrorResponse(
              session.sessionId,
              ProxyResponses.buildError(
                statusCode,
                clientErrorMessage,
                undefined,
                undefined,
                safeRequestId
              )
            );
          }

          // 覆写消息为空时回退到客户端安全消息
          const overrideErrorObj = override.response.error as Record<string, unknown>;
          const overrideMessage =
            typeof overrideErrorObj?.message === "string" &&
            overrideErrorObj.message.trim().length > 0
              ? overrideErrorObj.message
              : clientErrorMessage;

          // 构建覆写响应体
          // 设计原则：只输出用户配置的字段，不额外注入 request_id 等字段
          // 唯一的特殊处理：message 为空时回退到原始错误消息
          const responseBody = {
            ...override.response,
            error: {
              ...overrideErrorObj,
              message: overrideMessage,
            },
          };

          logger.info("ProxyErrorHandler: Applied error override response", {
            original: logErrorMessage.substring(0, 200),
            format: isClaudeErrorFormat(override.response)
              ? "claude"
              : isGeminiErrorFormat(override.response)
                ? "gemini"
                : isOpenAIErrorFormat(override.response)
                  ? "openai"
                  : "unknown",
            statusCode: responseStatusCode,
          });

          logger.error("ProxyErrorHandler: Request failed (overridden)", {
            error: logErrorMessage,
            statusCode: responseStatusCode,
            overridden: true,
          });

          return await attachSessionIdToErrorResponse(
            session.sessionId,
            new Response(JSON.stringify(responseBody), {
              status: responseStatusCode,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        // 情况 2: 仅状态码覆写 - 返回客户端安全消息，但使用覆写的状态码
        logger.info("ProxyErrorHandler: Applied status code override only", {
          original: logErrorMessage.substring(0, 200),
          originalStatusCode: statusCode,
          overrideStatusCode: responseStatusCode,
          hasRequestId: !!safeRequestId,
        });

        logger.error("ProxyErrorHandler: Request failed (status overridden)", {
          error: logErrorMessage,
          statusCode: responseStatusCode,
          overridden: true,
        });

        return await attachSessionIdToErrorResponse(
          session.sessionId,
          ProxyResponses.buildError(
            responseStatusCode,
            clientErrorMessage,
            undefined,
            undefined,
            safeRequestId
          )
        );
      }
    }

    logger.error("ProxyErrorHandler: Request failed", {
      error: logErrorMessage,
      statusCode,
      overridden: false,
    });

    return await attachSessionIdToErrorResponse(
      session.sessionId,
      ProxyResponses.buildError(statusCode, clientErrorMessage)
    );
  }

  /**
   * 构建 Rate Limit 响应（402/429）
   *
   * - RPM/并发用 429 Too Many Requests（可重试的频率控制）
   * - 消费限额用 402 Payment Required（需充值/等待重置）
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
    // 使用 helper 函数计算状态码
    const statusCode = getRateLimitStatusCode(error.limitType);

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
      "Retry-After": ProxyErrorHandler.calculateRetryAfter(error.resetTime),
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
        status: statusCode, // 根据 limitType 动态选择 429 或 402
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
      context1mApplied: session.getContext1mApplied(),
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
