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
 * 错误分类：区分供应商错误、持续性网络错误、临时错误和客户端中断
 */
export enum ErrorCategory {
  PROVIDER_ERROR, // 供应商问题（所有 4xx/5xx HTTP 错误）→ 计入熔断器 + 直接切换
  NETWORK_ERROR, // 持续性网络故障（DNS失败、连接拒绝、超时等）→ 计入熔断器 + 直接切换
  TRANSIENT_ERROR, // 临时系统错误（可能恢复）→ 不计入熔断器 + 先重试1次
  CLIENT_ABORT, // 客户端主动中断 → 不计入熔断器 + 不重试 + 直接返回
}

/**
 * 持续性网络错误代码（应计入熔断器的错误）
 * 这些错误通常表示供应商不可达或服务不可用
 */
const PERSISTENT_NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND", // DNS 解析失败 - 域名无法解析
  "ECONNREFUSED", // 连接被拒绝 - 端口未监听或防火墙阻止
  "ETIMEDOUT", // 连接或读取超时 - 网络不通或服务无响应
  "EHOSTUNREACH", // 主机不可达 - 路由失败
  "ENETUNREACH", // 网络不可达 - 网络层故障
]);

/**
 * 判断错误类型
 *
 * 分类规则：
 * - ProxyError（所有 4xx/5xx HTTP 错误）：供应商问题
 *   → 说明请求到达供应商并得到响应，但供应商无法正常处理
 *   → 应计入熔断器，连续失败时触发熔断保护
 *   → 应直接切换到其他供应商
 *
 * - 客户端中断（AbortError 或 error.code === 'ECONNRESET' 且 statusCode === 499）：客户端主动中断
 *   → 客户端关闭连接或主动取消请求
 *   → 不应计入熔断器（不是供应商问题）
 *   → 不应重试（客户端已经不想要结果了）
 *   → 应立即返回错误
 *
 * - 持续性网络错误（ENOTFOUND、ECONNREFUSED、ETIMEDOUT 等）：供应商网络故障
 *   → 包括：DNS 解析失败、连接被拒绝、连接超时、主机不可达等
 *   → **应计入供应商熔断器**（供应商服务不可达，应触发熔断保护）
 *   → 应直接切换供应商（连续失败会自动熔断）
 *
 * - 临时系统错误（其他 fetch 异常）：可能恢复的临时问题
 *   → 包括：代理临时故障、轻度网络抖动等
 *   → 不应计入熔断器（不是供应商问题）
 *   → 应先重试1次当前供应商（可能是临时抖动）
 *
 * @param error - 捕获的错误对象
 * @returns 错误分类（PROVIDER_ERROR、NETWORK_ERROR、TRANSIENT_ERROR 或 CLIENT_ABORT）
 */
export function categorizeError(error: Error): ErrorCategory {
  // 客户端中断检测（优先级最高）
  if (
    error.name === "AbortError" ||
    error.message.includes("aborted") ||
    (error instanceof ProxyError && error.statusCode === 499)
  ) {
    return ErrorCategory.CLIENT_ABORT; // 客户端主动中断
  }

  // ProxyError = HTTP 错误（4xx 或 5xx）
  if (error instanceof ProxyError) {
    return ErrorCategory.PROVIDER_ERROR; // 所有 HTTP 错误都是供应商问题
  }

  // 检查是否是持续性网络错误（应计入熔断器）
  const nodeError = error as Error & { code?: string };
  if (nodeError.code && PERSISTENT_NETWORK_ERROR_CODES.has(nodeError.code)) {
    return ErrorCategory.NETWORK_ERROR; // 持续性网络故障，计入熔断器
  }

  // 其他所有错误都是临时系统错误（可能恢复）
  // 包括：
  // - TypeError: fetch failed (未知网络层错误)
  // - ECONNRESET: 连接被重置（可能是临时网络抖动，非客户端主动中断）
  // - 代理相关临时错误等
  return ErrorCategory.TRANSIENT_ERROR; // 临时错误，先重试1次
}
