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

  // group-rate-limit (§5.3/§10): when spend was split off by a model-group limit, the gate
  // value (currentCost = counted toward global) differs from total spend. Surface both so
  // the reader is not confused by "total spend != global-limit value".
  const modelGroupOnly = data.modelGroupOnlyCost ?? 0;
  const hasSplit = modelGroupOnly > 0;
  const currentCostLabel = hasSplit ? "当前消费（计入全局额）" : "当前消费";
  const splitFields = hasSplit
    ? [
        { label: "模型组单算", value: `$${modelGroupOnly.toFixed(4)}` },
        {
          label: "总消费",
          value: `$${(data.currentCost + modelGroupOnly).toFixed(4)}`,
        },
      ]
    : [];

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
              { label: currentCostLabel, value: `$${data.currentCost.toFixed(4)}` },
              ...splitFields,
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
