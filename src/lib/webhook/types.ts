/**
 * 平台无关的结构化消息类型
 */

export type MessageLevel = "info" | "warning" | "error";

export interface MessageHeader {
  title: string;
  icon?: string;
  level: MessageLevel;
}

export interface ListItem {
  icon?: string;
  primary: string;
  secondary?: string;
}

export type SectionContent =
  | { type: "text"; value: string }
  | { type: "quote"; value: string }
  | { type: "fields"; items: { label: string; value: string }[] }
  | { type: "list"; style: "ordered" | "bullet"; items: ListItem[] }
  | { type: "divider" };

export interface Section {
  title?: string;
  content: SectionContent[];
}

export interface StructuredMessage {
  header: MessageHeader;
  sections: Section[];
  footer?: Section[];
  timestamp: Date;
}

/**
 * 业务数据类型
 */

export interface CircuitBreakerAlertData {
  providerName: string;
  providerId: number;
  failureCount: number;
  retryAt: string;
  lastError?: string;
}

export interface DailyLeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

export interface DailyLeaderboardData {
  date: string;
  entries: DailyLeaderboardEntry[];
  totalRequests: number;
  totalCost: number;
}

export interface CostAlertData {
  targetType: "user" | "provider";
  targetName: string;
  targetId: number;
  currentCost: number;
  quotaLimit: number;
  threshold: number;
  period: string;
}

/**
 * Webhook 相关类型
 */

export type ProviderType = "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";

export type WebhookNotificationType = "circuit_breaker" | "daily_leaderboard" | "cost_alert";

export interface WebhookTargetConfig {
  id?: number;
  name?: string;
  providerType: ProviderType;

  webhookUrl?: string | null;

  telegramBotToken?: string | null;
  telegramChatId?: string | null;

  dingtalkSecret?: string | null;

  customTemplate?: Record<string, unknown> | null;
  customHeaders?: Record<string, string> | null;

  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
}

export interface WebhookSendOptions {
  notificationType?: WebhookNotificationType;
  data?: unknown;
  templateOverride?: Record<string, unknown> | null;
}

export interface WebhookPayload {
  body: string;
  headers?: Record<string, string>;
}

export interface WebhookResult {
  success: boolean;
  error?: string;
}
