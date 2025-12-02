import crypto from "node:crypto";
import type { Context } from "hono";
import type { Key } from "@/types/key";
import type { ProviderChainItem } from "@/types/message";
import type { Provider, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";
import type { ClientFormat } from "./format-mapper";

export interface AuthState {
  user: User | null;
  key: Key | null;
  apiKey: string | null;
  success: boolean;
}

export interface MessageContext {
  id: number;
  user: User;
  key: Key;
  apiKey: string;
}

export interface ProxyRequestPayload {
  message: Record<string, unknown>;
  buffer?: ArrayBuffer;
  log: string;
  note?: string;
  model: string | null;
}

interface RequestBodyResult {
  requestMessage: Record<string, unknown>;
  requestBodyLog: string;
  requestBodyLogNote?: string;
  requestBodyBuffer?: ArrayBuffer;
}

export class ProxySession {
  readonly startTime: number;
  readonly method: string;
  requestUrl: URL; // 非 readonly，允许模型重定向修改 Gemini URL 路径
  readonly headers: Headers;
  readonly headerLog: string;
  readonly request: ProxyRequestPayload;
  readonly userAgent: string | null; // User-Agent（用于客户端类型分析）
  readonly context: Context; // Hono Context（用于转换器）
  readonly clientAbortSignal: AbortSignal | null; // 客户端中断信号
  userName: string;
  authState: AuthState | null;
  provider: Provider | null;
  messageContext: MessageContext | null;

  // Session ID（用于会话粘性和并发限流）
  sessionId: string | null;

  // 请求格式追踪：记录原始请求格式和供应商类型
  originalFormat: ClientFormat = "claude";
  providerType: ProviderType | null = null;

  // 模型重定向追踪：保存原始模型名（重定向前）
  private originalModelName: string | null = null;

  // 原始 URL 路径（用于 Gemini 模型重定向重置）
  private originalUrlPathname: string | null = null;

  // 上游决策链（记录尝试的供应商列表）
  private providerChain: ProviderChainItem[];

  // 上次选择的决策上下文（用于记录到 providerChain）
  private _lastSelectionContext?: ProviderChainItem["decisionContext"];

  private constructor(init: {
    startTime: number;
    method: string;
    requestUrl: URL;
    headers: Headers;
    headerLog: string;
    request: ProxyRequestPayload;
    userAgent: string | null;
    context: Context;
    clientAbortSignal: AbortSignal | null;
  }) {
    this.startTime = init.startTime;
    this.method = init.method;
    this.requestUrl = init.requestUrl;
    this.headers = init.headers;
    this.headerLog = init.headerLog;
    this.request = init.request;
    this.userAgent = init.userAgent;
    this.context = init.context;
    this.clientAbortSignal = init.clientAbortSignal;
    this.userName = "unknown";
    this.authState = null;
    this.provider = null;
    this.messageContext = null;
    this.sessionId = null;
    this.providerChain = [];
  }

  static async fromContext(c: Context): Promise<ProxySession> {
    const startTime = Date.now();
    const method = c.req.method.toUpperCase();
    const requestUrl = new URL(c.req.url);
    const headers = new Headers(c.req.header());
    const headerLog = formatHeadersForLog(headers);
    const bodyResult = await parseRequestBody(c);

    // 提取 User-Agent
    const userAgent = headers.get("user-agent") || null;

    // 提取客户端 AbortSignal（如果存在）
    const clientAbortSignal = c.req.raw.signal || null;

    const modelFromBody =
      typeof bodyResult.requestMessage.model === "string" ? bodyResult.requestMessage.model : null;

    // 针对官方 Gemini 路径（/v1beta/models/{model}:generateContent）
    // 请求体中通常没有 model 字段，需从 URL 路径提取用于调度器匹配
    const modelFromPath = extractModelFromPath(requestUrl.pathname);

    // 双重检测（请求体优先，其次路径），若判断为 Gemini 请求则给出默认模型
    const isLikelyGeminiRequest =
      Array.isArray((bodyResult.requestMessage as Record<string, unknown>).contents) ||
      typeof (bodyResult.requestMessage as Record<string, unknown>).request === "object" ||
      modelFromPath !== null;

    const resolvedModel =
      modelFromBody ?? modelFromPath ?? (isLikelyGeminiRequest ? "gemini-2.5-flash" : null);

    const request: ProxyRequestPayload = {
      message: bodyResult.requestMessage,
      buffer: bodyResult.requestBodyBuffer,
      log: bodyResult.requestBodyLog,
      note: bodyResult.requestBodyLogNote,
      model: resolvedModel,
    };

    return new ProxySession({
      startTime,
      method,
      requestUrl,
      headers,
      headerLog,
      request,
      userAgent,
      context: c,
      clientAbortSignal,
    });
  }

  setAuthState(state: AuthState): void {
    this.authState = state;
    if (state.user) {
      this.userName = state.user.name;
    }
  }

  setProvider(provider: Provider | null): void {
    this.provider = provider;
    if (provider) {
      this.providerType = provider.providerType as ProviderType;
    }
  }

  /**
   * 设置原始请求格式（从路由层调用）
   */
  setOriginalFormat(format: ClientFormat): void {
    this.originalFormat = format;
  }

  setMessageContext(context: MessageContext | null): void {
    this.messageContext = context;
    if (context?.user) {
      this.userName = context.user.name;
    }
  }

  /**
   * 设置 session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * 生成基于请求指纹的确定性 Session ID
   *
   * 优先级与参考实现一致：
   * - API Key 前缀（x-api-key / x-goog-api-key 的前10位）
   * - User-Agent
   * - 客户端 IP（x-forwarded-for / x-real-ip）
   *
   * 当客户端未提供 metadata.session_id 时，可用于稳定绑定会话。
   */
  generateDeterministicSessionId(): string | null {
    const apiKeyHeader = this.headers.get("x-api-key") || this.headers.get("x-goog-api-key");
    const apiKeyPrefix = apiKeyHeader ? apiKeyHeader.substring(0, 10) : null;

    const userAgent = this.headers.get("user-agent");

    // 取链路上的首个 IP
    const forwardedFor = this.headers.get("x-forwarded-for");
    const realIp = this.headers.get("x-real-ip");
    const ip =
      forwardedFor?.split(",").map((ip) => ip.trim())[0] || (realIp ? realIp.trim() : null);

    const parts = [userAgent, ip, apiKeyPrefix].filter(Boolean);
    if (parts.length === 0) {
      return null;
    }

    const hash = crypto.createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
    // 取前 32 位作为稳定 ID，避免过长
    return `sess_${hash.substring(0, 32)}`;
  }

  /**
   * 获取 messages 数组长度（支持 Claude、Codex 和 Gemini 格式）
   */
  getMessagesLength(): number {
    const msg = this.request.message as Record<string, unknown>;
    // Claude 格式: messages[]
    if (Array.isArray(msg.messages)) {
      return msg.messages.length;
    }
    // Codex 格式: input[]
    if (Array.isArray(msg.input)) {
      return msg.input.length;
    }
    // Gemini 格式: contents[]
    if (Array.isArray(msg.contents)) {
      return msg.contents.length;
    }
    // Gemini CLI 包装格式: request.contents[]
    const requestData = msg.request as Record<string, unknown> | undefined;
    if (requestData && Array.isArray(requestData.contents)) {
      return requestData.contents.length;
    }
    return 0;
  }

  /**
   * 获取 messages 数组（支持 Claude、Codex 和 Gemini 格式）
   */
  getMessages(): unknown {
    const msg = this.request.message as Record<string, unknown>;
    // Claude 格式优先
    if (msg.messages !== undefined) {
      return msg.messages;
    }
    // Codex 格式
    if (msg.input !== undefined) {
      return msg.input;
    }
    // Gemini 格式: contents[]
    if (msg.contents !== undefined) {
      return msg.contents;
    }
    // Gemini CLI 包装格式: request.contents[]
    const requestData = msg.request as Record<string, unknown> | undefined;
    if (requestData?.contents !== undefined) {
      return requestData.contents;
    }
    return undefined;
  }

  /**
   * 是否应该复用 provider（基于 messages 长度）
   */
  shouldReuseProvider(): boolean {
    return this.getMessagesLength() > 1;
  }

  /**
   * 添加供应商到决策链（带详细元数据）
   */
  addProviderToChain(
    provider: Provider,
    metadata?: {
      reason?:
        | "session_reuse"
        | "initial_selection"
        | "concurrent_limit_failed"
        | "request_success" // 修复：添加 request_success
        | "retry_success"
        | "retry_failed" // 供应商错误（已计入熔断器）
        | "system_error" // 系统/网络错误（不计入熔断器）
        | "retry_with_official_instructions" // Codex instructions 自动重试（官方）
        | "retry_with_cached_instructions" // Codex instructions 智能重试（缓存）
        | "client_error_non_retryable" // 不可重试的客户端错误（Prompt 超限、内容过滤、PDF 限制、Thinking 格式）
        | "http2_fallback"; // HTTP/2 协议错误，回退到 HTTP/1.1（不切换供应商、不计入熔断器）
      selectionMethod?:
        | "session_reuse"
        | "weighted_random"
        | "group_filtered"
        | "fail_open_fallback";
      circuitState?: "closed" | "open" | "half-open";
      attemptNumber?: number;
      errorMessage?: string; // 错误信息（失败时记录）
      // 修复：添加新字段
      statusCode?: number; // 成功时的状态码
      circuitFailureCount?: number; // 熔断失败计数
      circuitFailureThreshold?: number; // 熔断阈值
      errorDetails?: ProviderChainItem["errorDetails"]; // 结构化错误详情
      decisionContext?: ProviderChainItem["decisionContext"];
    }
  ): void {
    const item: ProviderChainItem = {
      id: provider.id,
      name: provider.name,
      // 元数据
      reason: metadata?.reason,
      selectionMethod: metadata?.selectionMethod,
      priority: provider.priority,
      weight: provider.weight,
      costMultiplier: provider.costMultiplier,
      groupTag: provider.groupTag,
      circuitState: metadata?.circuitState,
      timestamp: Date.now(),
      attemptNumber: metadata?.attemptNumber,
      errorMessage: metadata?.errorMessage, // 记录错误信息
      // 修复：记录新字段
      statusCode: metadata?.statusCode,
      circuitFailureCount: metadata?.circuitFailureCount,
      circuitFailureThreshold: metadata?.circuitFailureThreshold,
      errorDetails: metadata?.errorDetails, // 结构化错误详情
      decisionContext: metadata?.decisionContext,
    };

    // 避免重复添加同一个供应商（除非是重试，即有 attemptNumber）
    const shouldAdd =
      this.providerChain.length === 0 ||
      this.providerChain[this.providerChain.length - 1].id !== provider.id ||
      metadata?.attemptNumber !== undefined;

    if (shouldAdd) {
      this.providerChain.push(item);
    }
  }

  /**
   * 获取决策链
   */
  getProviderChain(): ProviderChainItem[] {
    return this.providerChain;
  }

  /**
   * 获取原始模型（用户请求的，用于计费）
   * 如果没有发生重定向，返回当前模型
   */
  getOriginalModel(): string | null {
    return this.originalModelName ?? this.request.model;
  }

  /**
   * 获取当前模型（可能已重定向，用于转发）
   */
  getCurrentModel(): string | null {
    return this.request.model;
  }

  /**
   * 获取请求的 API endpoint（来自 URL.pathname）
   * 处理边界：若 URL 不存在则返回 null
   */
  getEndpoint(): string | null {
    try {
      const url = this.requestUrl;
      if (!url || typeof url.pathname !== "string") return null;
      return url.pathname || "/";
    } catch {
      return null;
    }
  }

  /**
   * 是否为 count_tokens 请求端点
   * - 依据 URL pathname 判断：/v1/messages/count_tokens
   */
  isCountTokensRequest(): boolean {
    const endpoint = this.getEndpoint();
    return endpoint === "/v1/messages/count_tokens";
  }

  /**
   * 设置原始模型（在重定向前调用）
   * 只能设置一次，避免多次重定向覆盖
   * 同时保存原始 URL 路径（用于 Gemini 重置）
   */
  setOriginalModel(model: string | null): void {
    if (this.originalModelName === null) {
      this.originalModelName = model;
      this.originalUrlPathname = this.requestUrl.pathname;
    }
  }

  /**
   * 检查是否发生了模型重定向
   */
  isModelRedirected(): boolean {
    return this.originalModelName !== null && this.originalModelName !== this.request.model;
  }

  /**
   * 获取原始 URL 路径（用于 Gemini 模型重定向重置）
   */
  getOriginalUrlPathname(): string | null {
    return this.originalUrlPathname;
  }

  /**
   * 检查是否为 Claude Code CLI 探测请求
   * - [{"role":"user","content":"foo"}]
   * - [{"role":"user","content":"count"}]
   */
  isProbeRequest(): boolean {
    const messages = this.getMessages();

    // 必须是单条消息
    if (!Array.isArray(messages) || messages.length !== 1) {
      return false;
    }

    const firstMessage = messages[0] as Record<string, unknown>;
    const content = firstMessage.content;

    // content 必须是字符串
    if (typeof content !== "string") {
      return false;
    }

    // 匹配探测模式（完全匹配，忽略大小写和空格）
    const trimmed = content.trim().toLowerCase();
    return trimmed === "foo" || trimmed === "count";
  }

  /**
   * 设置上次选择的决策上下文（用于记录到 providerChain）
   */
  setLastSelectionContext(context: ProviderChainItem["decisionContext"]): void {
    this._lastSelectionContext = context;
  }

  /**
   * 获取上次选择的决策上下文
   */
  getLastSelectionContext(): ProviderChainItem["decisionContext"] | undefined {
    return this._lastSelectionContext;
  }
}

function formatHeadersForLog(headers: Headers): string {
  const collected: string[] = [];
  headers.forEach((value, key) => {
    collected.push(`${key}: ${value}`);
  });

  return collected.length > 0 ? collected.join("\n") : "(empty)";
}

function optimizeRequestMessage(message: Record<string, unknown>): Record<string, unknown> {
  const optimized = { ...message };

  if (Array.isArray(optimized.system)) {
    optimized.system = new Array(optimized.system.length).fill(0);
  }
  if (Array.isArray(optimized.messages)) {
    optimized.messages = new Array(optimized.messages.length).fill(0);
  }
  if (Array.isArray(optimized.tools)) {
    optimized.tools = new Array(optimized.tools.length).fill(0);
  }

  return optimized;
}

function extractModelFromPath(pathname: string): string | null {
  // 匹配官方 Gemini 路径：/v1beta/models/{model}:<action>
  const geminiMatch = pathname.match(/\/v1beta\/models\/([^/:]+)(?::[^/]+)?/);
  if (geminiMatch?.[1]) {
    return geminiMatch[1];
  }

  // 兼容 /v1/models/{model}:<action> 形式（未来可能的正式版本）
  const v1Match = pathname.match(/\/v1\/models\/([^/:]+)(?::[^/]+)?/);
  if (v1Match?.[1]) {
    return v1Match[1];
  }

  return null;
}

async function parseRequestBody(c: Context): Promise<RequestBodyResult> {
  const method = c.req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  if (!hasBody) {
    return { requestMessage: {}, requestBodyLog: "(empty)" };
  }

  const requestBodyBuffer = await c.req.raw.clone().arrayBuffer();
  const requestBodyText = new TextDecoder().decode(requestBodyBuffer);

  let requestMessage: Record<string, unknown> = {};
  let requestBodyLog: string;
  let requestBodyLogNote: string | undefined;

  try {
    const parsedMessage = JSON.parse(requestBodyText) as Record<string, unknown>;
    requestMessage = parsedMessage; // 保留原始数据用于业务逻辑
    requestBodyLog = JSON.stringify(optimizeRequestMessage(parsedMessage), null, 2); // 仅在日志中优化
  } catch {
    requestMessage = { raw: requestBodyText };
    requestBodyLog = requestBodyText;
    requestBodyLogNote = "请求体不是合法 JSON，已记录原始文本。";
  }

  return {
    requestMessage,
    requestBodyLog,
    requestBodyLogNote,
    requestBodyBuffer,
  };
}
