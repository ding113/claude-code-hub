import type { CostAlertData, StructuredMessage } from "../types";

function getUsageIndicator(percent: number): string {
  if (percent >= 90) return "🔴";
  if (percent >= 80) return "🟡";
  return "🟢";
}

export function buildCostAlertMessage(data: CostAlertData): StructuredMessage {
  const usagePercent = (data.currentCost / data.quotaLimit) * 100;
  const remaining = data.quotaLimit - data.currentCost;
  const targetTypeText = data.targetType === "user" ? "用户" : "供应商";

  return {
    header: {
      title: "成本预警提醒",
      icon: "💰",
      level: "warning",
    },
    sections: [
      {
        content: [
          {
            type: "quote",
            value: `${targetTypeText} ${data.targetName} 的消费已达到预警阈值`,
          },
        ],
      },
      {
        title: "消费详情",
        content: [
          {
            type: "fields",
            items: [
              { label: "当前消费", value: `$${data.currentCost.toFixed(4)}` },
              { label: "配额限制", value: `$${data.quotaLimit.toFixed(4)}` },
              {
                label: "使用比例",
                value: `${usagePercent.toFixed(1)}% ${getUsageIndicator(usagePercent)}`,
              },
              { label: "剩余额度", value: `$${remaining.toFixed(4)}` },
              { label: "统计周期", value: data.period },
            ],
          },
        ],
      },
    ],
    footer: [
      {
        content: [{ type: "text", value: "请注意控制消费" }],
      },
    ],
    timestamp: new Date(),
  };
}
