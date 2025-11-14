/**
 * 代理错误类 - 携带上游完整错误信息
 *
 * 设计原则：
 * 1. 数据结构优先：错误不是字符串，而是结构化对象
 * 2. 智能截断：JSON 完整保存，文本限制 500 字符
 * 3. 可读性优先：纯文本格式化，便于排查问题
 */
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
  NON_RETRYABLE_CLIENT_ERROR, // 客户端输入错误（Prompt 超限、内容过滤、PDF 限制、Thinking 格式、参数缺失、非法请求）→ 不计入熔断器 + 不重试 + 直接返回
}

/**
 * 预编译的不可重试客户端错误正则表达式数组
 * 用于高性能的白名单错误匹配，避免每次调用时重新编译正则
 *
 * 包含 6 类错误模式：
 * 1. Prompt 长度超限
 * 2. 内容过滤拦截
 * 3. PDF 页数限制
 * 4. Thinking 格式错误
 * 5. 参数缺失/验证错误
 * 6. 非法请求
 */
const NON_RETRYABLE_ERROR_PATTERNS = [
  /prompt is too long: \d+ tokens > \d+ maximum/i,
  /Request blocked by content filter|permission_error.*content filter/i,
  /A maximum of \d+ PDF pages may be provided/i,
  /thinking.*Input tag.*does not match|Expected.*thinking.*but found|thinking.*must start with a thinking block/i,
  /Field required|required field|missing required/i,
  /非法请求|illegal request|invalid request/i,
];

/**
 * 检测是否为不可重试的客户端输入错误
 *
 * 采用白名单模式，检测明确不应重试的客户端错误（如输入超限、内容过滤等），
 * 这些错误即使重试也不会成功，应直接返回给客户端，且不计入熔断器。
 *
 * 检测的 6 类错误：
 * 1. Prompt 长度超限：`prompt is too long: {tokens} tokens > {max} maximum`
 * 2. 内容过滤拦截：`Request blocked by content filter` 或 `permission_error.*content filter`
 * 3. PDF 页数限制：`A maximum of {n} PDF pages may be provided`
 * 4. Thinking 格式错误：
 *    - `thinking: Input tag 'X' found using 'type' does not match any of the expected tags`
 *    - `Expected.*thinking.*but found`
 *    - `thinking.*must start with a thinking block`
 * 5. 参数缺失/验证错误：`Field required`、`required field`、`missing required`
 * 6. 非法请求：`非法请求`、`illegal request`、`invalid request`
 *
 * @param error - 错误对象
 * @returns 是否为不可重试的客户端错误
 *
 * @example
 * isNonRetryableClientError(new ProxyError('prompt is too long: 207406 tokens > 200000 maximum', 400))
 * // => true
 *
 * @example
 * isNonRetryableClientError(new ProxyError('max_tokens: Field required', 400))
 * // => true
 *
 * @example
 * isNonRetryableClientError(new ProxyError('非法请求', 400))
 * // => true
 *
 * @example
 * isNonRetryableClientError(new ProxyError('Internal server error', 500))
 * // => false
 */
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

  // 使用预编译正则数组进行匹配，短路优化（第一个匹配成功立即返回）
  return NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
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
