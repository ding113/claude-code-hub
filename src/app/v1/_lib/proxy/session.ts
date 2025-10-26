import type { Context } from "hono";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";
import type { Key } from "@/types/key";
import type { ProviderChainItem } from "@/types/message";

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
  readonly requestUrl: URL;
  readonly headers: Headers;
  readonly headerLog: string;
  readonly request: ProxyRequestPayload;
  readonly userAgent: string | null; // User-Agent（用于客户端类型分析）
  userName: string;
  authState: AuthState | null;
  provider: Provider | null;
  messageContext: MessageContext | null;

  // Session ID（用于会话粘性和并发限流）
  sessionId: string | null;

  // Codex 支持：记录原始请求格式和供应商类型
  originalFormat: "response" | "openai" | "claude" = "claude";
  providerType: "claude" | "codex" | null = null;

  // 模型重定向追踪：保存原始模型名（重定向前）
  private originalModelName: string | null = null;

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
  }) {
    this.startTime = init.startTime;
    this.method = init.method;
    this.requestUrl = init.requestUrl;
    this.headers = init.headers;
    this.headerLog = init.headerLog;
    this.request = init.request;
    this.userAgent = init.userAgent;
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

    const request: ProxyRequestPayload = {
      message: bodyResult.requestMessage,
      buffer: bodyResult.requestBodyBuffer,
      log: bodyResult.requestBodyLog,
      note: bodyResult.requestBodyLogNote,
      model:
        typeof bodyResult.requestMessage.model === "string"
          ? bodyResult.requestMessage.model
          : null,
    };

    return new ProxySession({
      startTime,
      method,
      requestUrl,
      headers,
      headerLog,
      request,
      userAgent,
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
      this.providerType = (provider.providerType as "claude" | "codex") || "claude";
    }
  }

  /**
   * 设置原始请求格式（从路由层调用）
   */
  setOriginalFormat(format: "response" | "openai" | "claude"): void {
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
   * 获取 messages 数组长度
   */
  getMessagesLength(): number {
    const messages = (this.request.message as Record<string, unknown>).messages;
    return Array.isArray(messages) ? messages.length : 0;
  }

  /**
   * 获取 messages 数组
   */
  getMessages(): unknown {
    return (this.request.message as Record<string, unknown>).messages;
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
        | "retry_success"
        | "retry_failed";
      selectionMethod?:
        | "session_reuse"
        | "weighted_random"
        | "group_filtered"
        | "fail_open_fallback";
      circuitState?: "closed" | "open" | "half-open";
      attemptNumber?: number;
      errorMessage?: string; // 错误信息（失败时记录）
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
   * 设置原始模型（在重定向前调用）
   * 只能设置一次，避免多次重定向覆盖
   */
  setOriginalModel(model: string | null): void {
    if (this.originalModelName === null) {
      this.originalModelName = model;
    }
  }

  /**
   * 检查是否发生了模型重定向
   */
  isModelRedirected(): boolean {
    return this.originalModelName !== null && this.originalModelName !== this.request.model;
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
