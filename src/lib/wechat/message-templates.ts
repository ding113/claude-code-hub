/**
 * 企业微信消息模板
 * 使用 Markdown 格式，确保美观清晰
 */

/**
 * 熔断器打开告警消息
 */
export interface CircuitBreakerAlertData {
  providerName: string;
  providerId: number;
  failureCount: number;
  retryAt: string; // ISO 格式时间
  lastError?: string;
}

export function buildCircuitBreakerAlert(data: CircuitBreakerAlertData): string {
  const lines = [
    "## 🚨 供应商熔断告警",
    "",
    `> 供应商 **${data.providerName}** (ID: ${data.providerId}) 已触发熔断保护`,
    "",
    "**详细信息**",
    `失败次数: ${data.failureCount} 次`,
    `预计恢复: ${formatDateTime(data.retryAt)}`,
  ];

  if (data.lastError) {
    lines.push(`最后错误: \`${truncate(data.lastError, 100)}\``);
  }

  lines.push(
    "",
    "---",
    `${formatDateTime(new Date().toISOString())} · 熔断器将在预计时间后自动恢复`
  );

  return lines.join("\n");
}

/**
 * 每日用户消费排行榜消息
 */
export interface DailyLeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

export interface DailyLeaderboardData {
  date: string; // YYYY-MM-DD
  entries: DailyLeaderboardEntry[];
  totalRequests: number;
  totalCost: number;
}

export function buildDailyLeaderboard(data: DailyLeaderboardData): string {
  const lines = ["## 📊 过去24小时用户消费排行榜", "", `> 统计时间: **${data.date}**`, ""];

  if (data.entries.length === 0) {
    lines.push("暂无数据");
  } else {
    lines.push("**排名情况**");
    lines.push("");

    data.entries.forEach((entry, index) => {
      const medal = getMedal(index);
      lines.push(
        `${medal} **${entry.userName}** (ID: ${entry.userId})`,
        `消费 $${entry.totalCost.toFixed(4)} · 请求 ${entry.totalRequests.toLocaleString()} 次 · Token ${formatTokens(entry.totalTokens)}`,
        ""
      );
    });

    lines.push(
      "---",
      "**总览**",
      `总请求 ${data.totalRequests.toLocaleString()} 次 · 总消费 $${data.totalCost.toFixed(4)}`,
      "",
      formatDateTime(new Date().toISOString())
    );
  }

  return lines.join("\n");
}

/**
 * 成本预警消息
 */
export interface CostAlertData {
  targetType: "user" | "provider";
  targetName: string;
  targetId: number;
  currentCost: number;
  quotaLimit: number;
  threshold: number; // 0-1
  period: string; // "5小时" | "本周" | "本月"
}

export function buildCostAlert(data: CostAlertData): string {
  const usagePercent = (data.currentCost / data.quotaLimit) * 100;
  const remaining = data.quotaLimit - data.currentCost;
  const targetTypeText = data.targetType === "user" ? "用户" : "供应商";

  const lines = [
    "## ⚠️ 成本预警提醒",
    "",
    `> ${targetTypeText} **${data.targetName}** 的消费已达到预警阈值`,
    "",
    "**消费详情**",
    `当前消费: $${data.currentCost.toFixed(4)}`,
    `配额限制: $${data.quotaLimit.toFixed(4)}`,
    `使用比例: **${usagePercent.toFixed(1)}%** ${getUsageBar(usagePercent)}`,
    `剩余额度: $${remaining.toFixed(4)}`,
    `统计周期: ${data.period}`,
    "",
    "---",
    `${formatDateTime(new Date().toISOString())} · 请注意控制消费`,
  ];

  return lines.join("\n");
}

/**
 * 辅助函数: 格式化日期时间
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * 辅助函数: 截断字符串
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}

/**
 * 辅助函数: 获取排名奖牌
 */
function getMedal(index: number): string {
  const medals = ["🥇", "🥈", "🥉"];
  return medals[index] || `${index + 1}.`;
}

/**
 * 辅助函数: 格式化 Token 数量
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(2)}K`;
  }
  return tokens.toLocaleString();
}

/**
 * 辅助函数: 生成使用率进度条
 */
function getUsageBar(percent: number): string {
  if (percent >= 90) return "🔴"; // 红色 - 危险
  if (percent >= 80) return "🟡"; // 黄色 - 警告
  return "🟢"; // 绿色 - 正常
}
