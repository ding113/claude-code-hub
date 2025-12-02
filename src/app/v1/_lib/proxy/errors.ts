/**
 * 代理错误类 - 携带上游完整错误信息
 *
 * 设计原则：
 * 1. 数据结构优先：错误不是字符串，而是结构化对象
 * 2. 智能截断：JSON 完整保存，文本限制 500 字符
 * 3. 可读性优先：纯文本格式化，便于排查问题
 */
import { type ErrorDetectionResult, errorRuleDetector } from "@/lib/error-rule-detector";
import type { ErrorOverrideResponse } from "@/repository/error-rules";

export class ProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly upstreamError?: {
      body: string; // 原始响应体（智能截断）
      parsed?: unknown; // 解析后的 JSON（如果有）
      providerId?: number;
      providerName?: string;
      requestId?: string; // 上游请求 ID（用于覆写响应时注入）
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
    let parsed: unknown;

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

    // 5. 提取 request_id（从响应体或响应头）
    const requestId =
      ProxyError.extractRequestIdFromBody(parsed) ||
      ProxyError.extractRequestIdFromHeaders(response.headers);

    return new ProxyError(message, response.status, {
      body: truncatedBody,
      parsed,
      providerId: provider.id,
      providerName: provider.name,
      requestId,
    });
  }

  /**
   * 从解析后的 JSON 响应体中提取 request_id
   *
   * 支持多种嵌套格式：
   * 1. 顶层 request_id/requestId（标准 Claude/OpenAI 格式）
   * 2. error 对象内的 request_id/requestId
   * 3. error.upstream_error 对象内的 request_id/requestId（中继服务格式）
   * 4. message 字段内嵌套 JSON 字符串中的 request_id（某些代理服务格式）
   *
   * @example
   * // 标准格式
   * { "request_id": "req_xxx" }
   *
   * // error 对象内
   * { "error": { "request_id": "req_xxx" } }
   *
   * // upstream_error 格式
   * { "error": { "upstream_error": { "request_id": "req_xxx" } } }
   *
   * // message 内嵌套 JSON
   * { "error": { "message": "{\"request_id\":\"req_xxx\"}" } }
   */
  private static extractRequestIdFromBody(parsed: unknown): string | undefined {
    if (!parsed || typeof parsed !== "object") return undefined;
    return ProxyError.extractRequestIdFromObject(parsed as Record<string, unknown>);
  }

  /**
   * 通用的 request_id 提取逻辑
   *
   * @param obj - 要提取的对象
   * @param remainingDepth - 允许的嵌套 JSON 解析次数，防止循环/过度 JSON.parse
   */
  private static extractRequestIdFromObject(
    obj: Record<string, unknown>,
    remainingDepth: number = 2
  ): string | undefined {
    let depthBudget = remainingDepth;

    // 1. 检查顶层 request_id/requestId
    const flatRequestId = ProxyError.extractRequestIdFromFlat(obj);
    if (flatRequestId) {
      return flatRequestId;
    }

    // 2. 检查 error 对象内的各种格式
    if (obj.error && typeof obj.error === "object") {
      const errorObj = obj.error as Record<string, unknown>;

      // 2.1 直接在 error 对象内的 request_id/requestId
      const errorRequestId = ProxyError.extractRequestIdFromFlat(errorObj);
      if (errorRequestId) {
        return errorRequestId;
      }

      // 2.2 检查 error.upstream_error 对象（中继服务格式）
      if (errorObj.upstream_error && typeof errorObj.upstream_error === "object") {
        const upstreamError = errorObj.upstream_error as Record<string, unknown>;

        // 2.2.1 直接在 upstream_error 对象内的 request_id
        const upstreamRequestId = ProxyError.extractRequestIdFromFlat(upstreamError);
        if (upstreamRequestId) {
          return upstreamRequestId;
        }

        // 2.2.2 检查 upstream_error.error 对象（深层嵌套格式）
        // 例如: { error: { upstream_error: { error: { message: "{...request_id...}" } } } }
        if (upstreamError.error && typeof upstreamError.error === "object") {
          const nestedError = upstreamError.error as Record<string, unknown>;

          // 检查 upstream_error.error.request_id
          const nestedRequestId = ProxyError.extractRequestIdFromFlat(nestedError);
          if (nestedRequestId) {
            return nestedRequestId;
          }

          // 检查 upstream_error.error.message 内的嵌套格式
          if (typeof nestedError.message === "string" && depthBudget > 0) {
            const msgRequestId = ProxyError.extractRequestIdFromJsonString(
              nestedError.message,
              depthBudget - 1
            );
            if (msgRequestId) {
              return msgRequestId;
            }
          }
        }
      }

      // 2.3 尝试从 error.message 字段解析嵌套 JSON
      if (typeof errorObj.message === "string" && depthBudget > 0) {
        const nestedRequestId = ProxyError.extractRequestIdFromJsonString(
          errorObj.message,
          depthBudget - 1
        );
        if (nestedRequestId) {
          return nestedRequestId;
        }
        depthBudget -= 1; // 消耗一次尝试，避免重复解析同一层 message
      }
    }

    // 3. 检查顶层 message 字段内的嵌套 JSON
    if (typeof obj.message === "string" && depthBudget > 0) {
      return ProxyError.extractRequestIdFromJsonString(obj.message, depthBudget - 1);
    }

    return undefined;
  }

  /**
   * 从对象中直接提取 request_id（不递归）
   */
  private static extractRequestIdFromFlat(obj: Record<string, unknown>): string | undefined {
    if (typeof obj.request_id === "string" && obj.request_id.trim()) {
      return obj.request_id.trim();
    }
    if (typeof obj.requestId === "string" && obj.requestId.trim()) {
      return obj.requestId.trim();
    }
    return undefined;
  }

  /**
   * 从可能包含 JSON 或 request_id 的字符串中提取 request_id
   *
   * 支持的格式：
   * 1. 纯 JSON 字符串: `{"request_id":"req_xxx"}`
   * 2. JSON + 尾部文本: `{"request_id":"req_xxx"}（traceid: ...）`
   * 3. 纯文本格式: `... (request id: xxx)` 或 `... (request_id: xxx)`
   *
   * @param str - 可能包含 JSON 或 request_id 的字符串
   * @param remainingDepth - 允许的嵌套 JSON 解析次数
   * @returns 提取的 request_id，如果未找到则返回 undefined
   */
  private static extractRequestIdFromJsonString(
    str: string,
    remainingDepth: number = 2
  ): string | undefined {
    const trimmed = str.trim();
    if (remainingDepth < 0) {
      return undefined;
    }

    // 策略 1: 尝试解析 JSON（可能以 { 开头）
    if (trimmed.startsWith("{")) {
      // 尝试直接解析整个字符串
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return ProxyError.extractRequestIdFromObject(
            parsed as Record<string, unknown>,
            remainingDepth
          );
        }
      } catch {
        // JSON.parse 失败，可能是 JSON + 尾部文本的情况
        // 尝试提取 JSON 部分（找到匹配的 } 位置）
        const jsonPart = ProxyError.extractJsonFromString(trimmed);
        if (jsonPart) {
          try {
            const parsed = JSON.parse(jsonPart);
            if (parsed && typeof parsed === "object") {
              return ProxyError.extractRequestIdFromObject(
                parsed as Record<string, unknown>,
                remainingDepth
              );
            }
          } catch {
            // 提取的部分也不是有效 JSON，继续尝试其他策略
          }
        }
      }
    }

    // 策略 2: 正则提取纯文本格式的 request_id
    // 匹配: (request id: xxx) 或 (request_id: xxx) 或 request_id: xxx
    return ProxyError.extractRequestIdFromText(str);
  }

  /**
   * 从字符串中提取 JSON 对象部分
   *
   * 处理类似 `{"key":"value"}（额外文本）` 的情况
   * 通过括号匹配找到 JSON 对象的结束位置
   */
  private static extractJsonFromString(str: string): string | null {
    if (!str.startsWith("{")) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === "\\") {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          // 找到匹配的结束括号
          return str.substring(0, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * 从纯文本中提取 request_id
   *
   * 支持的格式：
   * - (request id: xxx)
   * - (request_id: xxx)
   * - request_id: "xxx"
   * - "request_id": "xxx"
   */
  private static extractRequestIdFromText(str: string): string | undefined {
    // 模式 1: (request id: xxx) 或 (request_id: xxx) - 括号内格式
    const parenMatch = str.match(/\(request[_ ]id:\s*([^)]+)\)/i);
    if (parenMatch?.[1]) {
      return parenMatch[1].trim();
    }

    // 模式 2: "request_id": "xxx" - JSON 字段格式（用于部分损坏的 JSON）
    const jsonFieldMatch = str.match(/"request_id"\s*:\s*"([^"]+)"/);
    if (jsonFieldMatch?.[1]) {
      return jsonFieldMatch[1].trim();
    }

    return undefined;
  }

  /**
   * 从响应头中提取 request_id
   */
  private static extractRequestIdFromHeaders(headers: Headers): string | undefined {
    // 常见的 request_id 响应头名称
    const headerNames = ["x-request-id", "request-id", "x-amzn-requestid"];
    for (const name of headerNames) {
      const value = headers.get(name);
      if (value?.trim()) {
        return value.trim();
      }
    }
    return undefined;
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
      return `${body.substring(0, 500)}...`;
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

/**
 * 从错误对象中提取用于规则匹配的内容
 *
 * 优先使用整个响应体（upstreamError.body），这样规则可以匹配响应中的任何内容
 * 如果没有响应体，则使用错误消息
 */
function extractErrorContentForDetection(error: Error): string {
  // 优先使用整个响应体进行规则匹配
  if (error instanceof ProxyError && error.upstreamError?.body) {
    return error.upstreamError.body;
  }
  return error.message;
}

/**
 * 错误规则检测结果缓存
 *
 * 使用 WeakMap 避免内存泄漏，同一个 Error 对象只检测一次
 * 这样 isNonRetryableClientError 和 getErrorOverrideMessage 可以复用检测结果
 */
const errorDetectionCache = new WeakMap<Error, ErrorDetectionResult>();

/**
 * 检测错误规则（带缓存）
 *
 * 同一个 Error 对象只执行一次规则匹配，后续调用直接返回缓存结果
 *
 * 优化：避免在规则尚未初始化时缓存空结果
 * - 如果规则已初始化，正常缓存结果
 * - 如果规则未初始化，触发异步加载并返回同步结果（可能为空）
 *   后续请求会自动获取正确的缓存结果
 */
function detectErrorRuleOnce(error: Error): ErrorDetectionResult {
  const cached = errorDetectionCache.get(error);
  if (cached) {
    return cached;
  }

  const content = extractErrorContentForDetection(error);

  // 避免在规则尚未初始化时缓存可能不完整的结果
  if (!errorRuleDetector.hasInitialized()) {
    // 触发异步初始化，但不阻塞当前请求
    void errorRuleDetector
      .detectAsync(content)
      .then((result) => errorDetectionCache.set(error, result))
      .catch(() => undefined);

    // 返回同步结果（可能为空），不缓存以允许后续请求重新检测
    return errorRuleDetector.detect(content);
  }

  const result = errorRuleDetector.detect(content);
  errorDetectionCache.set(error, result);
  return result;
}

export function isNonRetryableClientError(error: Error): boolean {
  // 使用缓存的检测结果，避免重复执行规则匹配
  return detectErrorRuleOnce(error).matched;
}

/**
 * 错误覆写结果
 */
export interface ErrorOverrideResult {
  /** 覆写的响应体（可选，null 表示不覆写响应体，仅覆写状态码） */
  response: ErrorOverrideResponse | null;
  /** 覆写的状态码（可选，null 表示透传上游状态码） */
  statusCode: number | null;
}

/**
 * 检测错误并返回覆写配置（如果配置了）
 *
 * 用于在返回错误响应时应用覆写，将复杂的上游错误转换为友好的用户提示
 * 支持三种覆写模式：
 * 1. 仅覆写响应体
 * 2. 仅覆写状态码
 * 3. 同时覆写响应体和状态码
 *
 * @param error - 错误对象
 * @returns 覆写配置（如果配置了响应体或状态码），否则返回 undefined
 */
export function getErrorOverride(error: Error): ErrorOverrideResult | undefined {
  // 使用缓存的检测结果，避免重复执行规则匹配
  const result = detectErrorRuleOnce(error);

  // 只要配置了响应体或状态码，就返回覆写配置
  if (result.matched && (result.overrideResponse || result.overrideStatusCode)) {
    return {
      response: result.overrideResponse ?? null,
      statusCode: result.overrideStatusCode ?? null,
    };
  }

  return undefined;
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
      | "usd_total"
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

/**
 * HTTP/2 协议错误检测模式
 *
 * 包含常见的 HTTP/2 协议层错误标识：
 * - GOAWAY: 服务器关闭连接
 * - RST_STREAM: 流被重置
 * - PROTOCOL_ERROR: 协议错误
 * - HTTP/2: 通用 HTTP/2 错误
 * - ERR_HTTP2_*: Node.js/Chromium HTTP/2 错误代码
 * - NGHTTP2_*: nghttp2 库错误代码
 * - HTTP_1_1_REQUIRED: 服务器要求 HTTP/1.1
 * - REFUSED_STREAM: 服务器拒绝流
 */
const HTTP2_ERROR_PATTERNS = [
  "GOAWAY",
  "RST_STREAM",
  "PROTOCOL_ERROR",
  "HTTP/2",
  "ERR_HTTP2_",
  "NGHTTP2_",
  "HTTP_1_1_REQUIRED",
  "REFUSED_STREAM",
];

/**
 * 检测是否为 HTTP/2 协议错误
 *
 * HTTP/2 错误通常发生在协议协商或连接层面，例如：
 * - 服务器不支持 HTTP/2
 * - HTTP/2 连接被服务器关闭（GOAWAY）
 * - HTTP/2 流被重置（RST_STREAM）
 *
 * 检测逻辑：
 * 1. 检查错误名称
 * 2. 检查错误消息
 * 3. 检查错误代码（Node.js 风格）
 *
 * @param error - 错误对象
 * @returns 是否为 HTTP/2 协议错误
 *
 * @example
 * // Node.js HTTP/2 错误
 * isHttp2Error(new Error('ERR_HTTP2_GOAWAY_SESSION')) // true
 *
 * // 通用 HTTP/2 错误
 * isHttp2Error(new Error('HTTP/2 protocol error')) // true
 *
 * // 非 HTTP/2 错误
 * isHttp2Error(new Error('Connection refused')) // false
 */
export function isHttp2Error(error: Error): boolean {
  // 组合错误信息进行检测
  const errorString = [error.name, error.message, (error as NodeJS.ErrnoException).code ?? ""]
    .join(" ")
    .toUpperCase();

  return HTTP2_ERROR_PATTERNS.some((pattern) => errorString.includes(pattern.toUpperCase()));
}
