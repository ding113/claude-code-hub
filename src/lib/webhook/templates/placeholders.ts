import type {
  CircuitBreakerAlertData,
  CostAlertData,
  DailyLeaderboardData,
  Section,
  SectionContent,
  StructuredMessage,
  WebhookNotificationType,
} from "../types";

export interface TemplatePlaceholder {
  key: string;
  label: string;
  description: string;
}

export const WEBHOOK_NOTIFICATION_TYPES = [
  "circuit_breaker",
  "daily_leaderboard",
  "cost_alert",
] as const satisfies readonly WebhookNotificationType[];

export const TEMPLATE_PLACEHOLDERS = {
  common: [
    { key: "{{timestamp}}", label: "发送时间", description: "ISO 8601 格式" },
    {
      key: "{{timestamp_local}}",
      label: "本地时间",
      description: "本地格式化时间（系统时区）",
    },
    { key: "{{title}}", label: "消息标题", description: "通知标题" },
    { key: "{{level}}", label: "消息级别", description: "info / warning / error" },
    { key: "{{sections}}", label: "正文内容", description: "结构化消息内容（纯文本）" },
  ],
  circuit_breaker: [
    { key: "{{provider_name}}", label: "供应商名称", description: "触发熔断的供应商" },
    { key: "{{provider_id}}", label: "供应商ID", description: "供应商数字ID" },
    { key: "{{failure_count}}", label: "失败次数", description: "连续失败计数" },
    { key: "{{retry_at}}", label: "恢复时间", description: "预计恢复时间" },
    { key: "{{last_error}}", label: "错误信息", description: "最后一次错误详情" },
    {
      key: "{{incident_source}}",
      label: "熔断来源",
      description: "provider(Key 熔断) 或 endpoint(Endpoint 熔断)",
    },
    { key: "{{endpoint_id}}", label: "端点ID", description: "触发熔断的端点 ID" },
    { key: "{{endpoint_url}}", label: "端点地址", description: "触发熔断的端点 URL" },
  ],
  daily_leaderboard: [
    { key: "{{date}}", label: "统计日期", description: "YYYY-MM-DD 格式" },
    { key: "{{entries_json}}", label: "排行榜数据", description: "JSON 格式排行榜" },
    { key: "{{total_requests}}", label: "总请求数", description: "当日总请求量" },
    { key: "{{total_cost}}", label: "总消费", description: "当日总消费金额" },
  ],
  cost_alert: [
    { key: "{{target_type}}", label: "目标类型", description: "user 或 provider" },
    { key: "{{target_name}}", label: "目标名称", description: "用户名或供应商名" },
    { key: "{{current_cost}}", label: "当前消费", description: "当前已消费金额" },
    { key: "{{quota_limit}}", label: "配额上限", description: "配额限制金额" },
    { key: "{{usage_percent}}", label: "使用比例", description: "百分比(0-100)" },
  ],
} as const satisfies Record<string, readonly TemplatePlaceholder[]>;

export function getTemplatePlaceholders(
  notificationType?: WebhookNotificationType
): TemplatePlaceholder[] {
  const common = TEMPLATE_PLACEHOLDERS.common;
  if (!notificationType) {
    return [...common];
  }

  const specific = TEMPLATE_PLACEHOLDERS[notificationType];
  return specific ? [...common, ...specific] : [...common];
}

export function buildTemplateVariables(params: {
  message: StructuredMessage;
  notificationType?: WebhookNotificationType;
  data?: unknown;
  timezone?: string;
}): Record<string, string> {
  const { message, notificationType, data, timezone } = params;

  const values: Record<string, string> = {};

  // 通用字段
  values["{{timestamp}}"] = message.timestamp.toISOString();
  values["{{timestamp_local}}"] = formatLocalTimestamp(message.timestamp, timezone);
  values["{{title}}"] = message.header.title;
  values["{{level}}"] = message.header.level;
  values["{{sections}}"] = renderMessageSections(message);

  // 类型字段（尽量容错，避免模板渲染阻塞发送）
  if (notificationType === "circuit_breaker") {
    const cb = data as Partial<CircuitBreakerAlertData> | undefined;
    values["{{provider_name}}"] = cb?.providerName ?? "";
    values["{{provider_id}}"] = cb?.providerId !== undefined ? String(cb.providerId) : "";
    values["{{failure_count}}"] = cb?.failureCount !== undefined ? String(cb.failureCount) : "";
    values["{{retry_at}}"] = cb?.retryAt ?? "";
    values["{{last_error}}"] = cb?.lastError ?? "";
    values["{{incident_source}}"] = cb?.incidentSource ?? "provider";
    values["{{endpoint_id}}"] = cb?.endpointId !== undefined ? String(cb.endpointId) : "";
    values["{{endpoint_url}}"] = cb?.endpointUrl ?? "";
  }

  if (notificationType === "daily_leaderboard") {
    const dl = data as Partial<DailyLeaderboardData> | undefined;
    values["{{date}}"] = dl?.date ?? "";
    values["{{entries_json}}"] = dl?.entries !== undefined ? safeJsonStringify(dl.entries) : "[]";
    values["{{total_requests}}"] = dl?.totalRequests !== undefined ? String(dl.totalRequests) : "";
    values["{{total_cost}}"] = dl?.totalCost !== undefined ? String(dl.totalCost) : "";
  }

  if (notificationType === "cost_alert") {
    const ca = data as Partial<CostAlertData> | undefined;
    values["{{target_type}}"] = ca?.targetType ?? "";
    values["{{target_name}}"] = ca?.targetName ?? "";
    values["{{current_cost}}"] = ca?.currentCost !== undefined ? String(ca.currentCost) : "";
    values["{{quota_limit}}"] = ca?.quotaLimit !== undefined ? String(ca.quotaLimit) : "";
    values["{{usage_percent}}"] = buildUsagePercent(ca);
  }

  return values;
}

function buildUsagePercent(data: Partial<CostAlertData> | undefined): string {
  if (!data) return "";
  if (data.currentCost === undefined || data.quotaLimit === undefined || data.quotaLimit === 0) {
    return "";
  }
  const percent = (data.currentCost / data.quotaLimit) * 100;
  return Number.isFinite(percent) ? percent.toFixed(1) : "";
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

function formatLocalTimestamp(date: Date, timezone?: string): string {
  try {
    return date.toLocaleString("zh-CN", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    // Fallback to UTC if timezone is invalid
    return date.toLocaleString("zh-CN", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
}

function renderMessageSections(message: StructuredMessage): string {
  const lines: string[] = [];

  for (const section of message.sections) {
    lines.push(...renderSection(section));
    lines.push("");
  }

  if (message.footer) {
    lines.push("---");
    for (const section of message.footer) {
      lines.push(...renderSection(section));
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function renderSection(section: Section): string[] {
  const lines: string[] = [];

  if (section.title) {
    lines.push(section.title);
  }

  for (const content of section.content) {
    lines.push(...renderContent(content));
  }

  return lines;
}

function renderContent(content: SectionContent): string[] {
  switch (content.type) {
    case "text":
      return [content.value];

    case "quote":
      return [`> ${content.value}`];

    case "fields":
      return content.items.map((item) => `${item.label}: ${item.value}`);

    case "list":
      return content.items.flatMap((item, index) => {
        const prefix = content.style === "ordered" ? `${index + 1}.` : "-";
        const lines: string[] = [];
        lines.push(`${prefix} ${item.primary}`);
        if (item.secondary) {
          lines.push(`  ${item.secondary}`);
        }
        return lines;
      });

    case "divider":
      return ["---"];
  }
}
