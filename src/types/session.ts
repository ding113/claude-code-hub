/**
 * 活跃 Session 详细信息
 * 用于实时监控当前正在运行的请求（显示聚合总量）
 */
export interface ActiveSessionInfo {
  // 基础标识
  sessionId: string;

  // 用户和密钥信息
  userName: string;
  userId: number;
  keyId: number;
  keyName: string;

  // 供应商信息（可能包含多个）
  providerId: number | null;
  providerName: string | null; // 多个供应商时用逗号分隔

  // 请求元数据（可能包含多个）
  model: string | null; // 多个模型时用逗号分隔
  apiType: "chat" | "codex";
  startTime: number; // Unix timestamp (ms)

  // 使用量（总量聚合）
  inputTokens?: number; // 总输入 Token
  outputTokens?: number; // 总输出 Token
  cacheCreationInputTokens?: number; // 总缓存创建 Token
  cacheReadInputTokens?: number; // 总缓存读取 Token
  totalTokens?: number; // 总 Token 数
  costUsd?: string; // 总成本

  // 状态
  status: "in_progress" | "completed" | "error";
  statusCode?: number;
  errorMessage?: string;

  // 派生字段
  durationMs?: number; // 总耗时
  requestCount?: number; // 请求次数
  concurrentCount?: number; // 并发请求数（用于实时状态计算）
}

/**
 * Session 基础信息（存储到 Redis）
 */
export interface SessionStoreInfo {
  userName: string;
  userId: number;
  keyId: number;
  keyName: string;
  model: string | null;
  apiType: "chat" | "codex";
}

/**
 * Session 使用量信息（响应时更新）
 */
export interface SessionUsageUpdate {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd?: string;
  status: "completed" | "error";
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Session 供应商信息（选择后更新）
 */
export interface SessionProviderInfo {
  providerId: number;
  providerName: string;
}
