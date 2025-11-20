/**
 * 代理错误类 - 携带上游完整错误信息
 *
 * 设计原则：
 * 1. 数据结构优先：错误不是字符串，而是结构化对象
 * 2. 智能截断：JSON 完整保存，文本限制 500 字符
 * 3. 可读性优先：纯文本格式化，便于排查问题
 */
import { errorRuleDetector } from "@/lib/error-rule-detector";

export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly upstreamError?: {
      body: string; // 原始响应体（智能截断）
      parsed?: unknown; // 解析后的 JSON（如果有）
      providerId?: number;
      providerName?: string;
    }
  ) {
    super(message);
    this.name = "ProxyError";
  }

  /**
   * 从上游响应创建 ProxyError
   *
   * 流程：
   * 1. 读取响应体
   * 2. 识别 Content-Type 并解析 JSON
   * 3. 从 JSON 提取错误消息（支持多种格式）
   * 4. 智能截断（JSON 完整，文本 500 字符）
   */
  static async fromUpstreamResponse(
    response: Response,
    provider: { id: number; name: string }
  ): Promise<ProxyError> {
    const contentType = response.headers.get("content-type") || "";
    let body = "";
    let parsed: unknown = undefined;

    // 1. 读取响应体
    try {
      body = await response.text();
    } catch (error) {
      body = `Failed to read response body: ${(error as Error).message}`;
    }

    // 2. 尝试解析 JSON
    if (contentType.includes("application/json") && body) {
      try {
        parsed = JSON.parse(body);
      } catch {
        // 不是有效 JSON，保留原始文本
      }
    }

    // 3. 提取错误消息
    const extractedMessage = ProxyError.extractErrorMessage(parsed);
    const fallbackMessage = `Provider returned ${response.status}: ${response.statusText}`;
    const message = extractedMessage || fallbackMessage;

    // 4. 智能截断响应体
    const truncatedBody = ProxyError.smartTruncate(body, parsed);

    return new ProxyError(message, response.status, {
      body: truncatedBody,
      parsed,
      providerId: provider.id,
      providerName: provider.name,
    });
  }

  /**
   * 从 JSON 中提取错误消息
   * 支持的格式：
   * - Claude API: { "error": { "message": "...", "type": "..." } }
   * - OpenAI API: { "error": { "message": "..." } }
   * - Generic: { "message": "..." } 或 { "error": "..." }
   */
  private static extractErrorMessage(parsed: unknown): string | null {
    if (!parsed || typeof parsed !== "object") return null;

    const obj = parsed as Record<string, unknown>;

    // Claude/OpenAI 格式：{ "error": { "message": "..." } }
    if (obj.error && typeof obj.error === "object") {
      const errorObj = obj.error as Record<string, unknown>;

      // Claude 格式：带 type
      if (typeof errorObj.message === "string" && typeof errorObj.type === "string") {
        return `${errorObj.type}: ${errorObj.message}`;
      }

      // OpenAI 格式：仅 message
      if (typeof errorObj.message === "string") {
        return errorObj.message;
      }
    }

    // 通用格式：{ "message": "..." }
    if (typeof obj.message === "string") {
      return obj.message;
    }

    // 简单格式：{ "error": "..." }
    if (typeof obj.error === "string") {
      return obj.error;
    }

    return null;
  }

  /**
   * 智能截断响应体
   * - JSON: 完整保存（序列化后）
   * - 文本: 限制 500 字符
   */
  private static smartTruncate(body: string, parsed?: unknown): string {
    if (parsed) {
      // JSON 格式：完整保存
      return JSON.stringify(parsed);
    }

    // 纯文本：截断到 500 字符
    if (body.length > 500) {
      return body.substring(0, 500) + "...";
    }

    return body;
  }

  /**
   * 获取适合记录到数据库的详细错误信息
   * 格式：Provider {name} returned {status}: {message} | Upstream: {body}
   */
  getDetailedErrorMessage(): string {
    const parts: string[] = [];

    // Part 1: Provider 信息 + 状态码
    if (this.upstreamError?.providerName) {
      parts.push(
        `Provider ${this.upstreamError.providerName} returned ${this.statusCode}: ${this.message}`
      );
    } else {
      parts.push(this.message);
    }

    // Part 2: 上游响应（仅在有响应体时）
    if (this.upstreamError?.body) {
      parts.push(`Upstream: ${this.upstreamError.body}`);
    }

    return parts.join(" | ");
  }
}

/**
 * 错误分类：区分供应商错误和系统错误
 */
export enum ErrorCategory {
  PROVIDER_ERROR, // 供应商问题（所有 4xx/5xx HTTP 错误）→ 计入熔断器 + 直接切换
  SYSTEM_ERROR, // 系统/网络问题（fetch 网络异常）→ 不计入熔断器 + 先重试1次
  CLIENT_ABORT, // 客户端主动中断 → 不计入熔断器 + 不重试 + 直接返回
  NON_RETRYABLE_CLIENT_ERROR, // 客户端输入错误（Prompt 超限、内容过滤、PDF 限制、Thinking 格式、参数缺失/额外参数、非法请求）→ 不计入熔断器 + 不重试 + 直接返回
}

export function isNonRetryableClientError(error: Error): boolean {
  // 提取错误消息
  let message = error.message;

  // 如果是 ProxyError，优先从 upstreamError.parsed 中提取详细错误消息
  if (error instanceof ProxyError && error.upstreamError?.parsed) {
    const parsed = error.upstreamError.parsed as Record<string, unknown>;
    if (parsed.error && typeof parsed.error === "object") {
      const errorObj = parsed.error as Record<string, unknown>;
      if (typeof errorObj.message === "string") {
        message = errorObj.message;
      }
    }
    // 兼容智谱等供应商的 FastAPI/Pydantic 验证错误格式：{ "detail": [{ "msg": "..." }] }
    if (Array.isArray(parsed.detail)) {
      for (const item of parsed.detail) {
        if (item && typeof item === "object") {
          const detailObj = item as Record<string, unknown>;
          if (typeof detailObj.msg === "string") {
            message = detailObj.msg;
            break;
          }
        }
      }
    }
  }

  // 使用 ErrorRuleDetector 检测规则，支持数据库驱动的动态规则
  return errorRuleDetector.detect(message).matched;
}

/**
 * 检测是否为客户端中断错误
 *
 * 采用白名单模式，精确检测客户端主动中断的错误，避免误判业务错误。
 *
 * 检测逻辑（优先级从高到低）：
 * 1. 错误名称检查（最可靠）：AbortError、ResponseAborted
 * 2. HTTP 状态码检查：499（Client Closed Request）
 * 3. 错误消息检查（向后兼容）：仅检查精确的中断消息
 *
 * @param error - 错误对象
 * @returns 是否为客户端中断错误
 *
 * @example
 * isClientAbortError(new Error('AbortError')) // true
 * isClientAbortError(new Error('User aborted transaction')) // false（业务错误，不是客户端中断）
 */
export function isClientAbortError(error: Error): boolean {
  // 1. 检查错误名称（最可靠）
  if (error.name === "AbortError" || error.name === "ResponseAborted") {
    return true;
  }

  // 2. 检查 HTTP 状态码（Nginx 使用的 "Client Closed Request"）
  if (error instanceof ProxyError && error.statusCode === 499) {
    return true;
  }

  // 3. 检查精确的错误消息（白名单模式，向后兼容）
  const abortMessages = [
    "This operation was aborted", // 标准 AbortError 消息
    "The user aborted a request", // 浏览器标准消息
    "aborted", // 向后兼容（但需在前两个检查失败后才使用）
  ];

  return abortMessages.some((msg) => error.message.includes(msg));
}

/**
 * 限流错误类 - 携带详细的限流上下文信息
 *
 * 设计原则：
 * 1. 结构化错误：携带 7 个核心字段用于精确反馈
 * 2. 类型安全：使用 TypeScript 枚举确保限流类型正确
 * 3. 可追踪性：包含 provider_id 用于追溯限流来源
 */
export class RateLimitError extends Error {
  constructor(
    public readonly type: "rate_limit_error",
    message: string,
    public readonly limitType:
      | "rpm"
      | "usd_5h"
      | "usd_weekly"
      | "usd_monthly"
      | "concurrent_sessions"
      | "daily_quota",
    public readonly currentUsage: number,
    public readonly limitValue: number,
    public readonly resetTime: string, // ISO 8601 格式
    public readonly providerId: number | null = null
  ) {
    super(message);
    this.name = "RateLimitError";
  }

  /**
   * 获取适合记录到数据库的 JSON 元数据
   */
  toJSON() {
    return {
      type: this.type,
      limit_type: this.limitType,
      current_usage: this.currentUsage,
      limit_value: this.limitValue,
      reset_time: this.resetTime,
      provider_id: this.providerId,
      message: this.message,
    };
  }
}

/**
 * 类型守卫：检查是否为 RateLimitError
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

/**
 * 判断错误类型
 *
 * 分类规则（优先级从高到低）：
 * 1. 客户端主动中断（AbortError 或 error.code === 'ECONNRESET' 且 statusCode === 499）
 *    → 客户端关闭连接或主动取消请求
 *    → 不应计入熔断器（不是供应商问题）
 *    → 不应重试（客户端已经不想要结果了）
 *    → 应立即返回错误
 *
 * 2. 不可重试的客户端输入错误（Prompt 超限、内容过滤、PDF 限制、Thinking 参数格式错误、参数缺失、非法请求）
 *    → 客户端输入违反了 API 的硬性限制或安全策略
 *    → 不应计入熔断器（不是供应商故障）
 *    → 不应重试（重试也会失败）
 *    → 应立即返回错误，提示用户修正输入
 *
 * 3. 供应商问题（ProxyError - 所有 4xx/5xx HTTP 错误）
 *    → 说明请求到达供应商并得到响应，但供应商无法正常处理
 *    → 应计入熔断器，连续失败时触发熔断保护
 *    → 应直接切换到其他供应商
 *
 * 4. 系统/网络问题（fetch 网络异常）
 *    → 包括：DNS 解析失败、连接被拒绝、连接超时、网络中断等
 *    → 不应计入供应商熔断器（不是供应商服务不可用）
 *    → 应先重试1次当前供应商（可能是临时网络抖动）
 *
 * @param error - 捕获的错误对象
 * @returns 错误分类（CLIENT_ABORT、NON_RETRYABLE_CLIENT_ERROR、PROVIDER_ERROR 或 SYSTEM_ERROR）
 */
export function categorizeError(error: Error): ErrorCategory {
  // 优先级 1: 客户端中断检测（优先级最高）- 使用统一的精确检测函数
  if (isClientAbortError(error)) {
    return ErrorCategory.CLIENT_ABORT; // 客户端主动中断
  }

  // 优先级 2: 不可重试的客户端输入错误检测（白名单模式）
  if (isNonRetryableClientError(error)) {
    return ErrorCategory.NON_RETRYABLE_CLIENT_ERROR; // 客户端输入错误
  }

  // 优先级 3: ProxyError = HTTP 错误（4xx 或 5xx）
  if (error instanceof ProxyError) {
    return ErrorCategory.PROVIDER_ERROR; // 所有 HTTP 错误都是供应商问题
  }

  // 优先级 4: 其他所有错误都是系统错误
  // 包括：
  // - TypeError: fetch failed (网络层错误)
  // - ENOTFOUND: DNS 解析失败
  // - ECONNREFUSED: 连接被拒绝
  // - ETIMEDOUT: 连接或读取超时
  // - ECONNRESET: 连接被重置（非客户端主动）
  return ErrorCategory.SYSTEM_ERROR;
}
