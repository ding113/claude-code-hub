import type { CircuitBreakerAlertData, StructuredMessage } from "../types";
import { formatDateTime } from "../utils/date";

export function buildCircuitBreakerMessage(data: CircuitBreakerAlertData): StructuredMessage {
  const fields = [
    { label: "失败次数", value: `${data.failureCount} 次` },
    { label: "预计恢复", value: formatDateTime(data.retryAt) },
  ];

  if (data.lastError) {
    fields.push({ label: "最后错误", value: data.lastError });
  }

  return {
    header: {
      title: "供应商熔断告警",
      icon: "🔌",
      level: "error",
    },
    sections: [
      {
        content: [
          {
            type: "quote",
            value: `供应商 ${data.providerName} (ID: ${data.providerId}) 已触发熔断保护`,
          },
        ],
      },
      {
        title: "详细信息",
        content: [{ type: "fields", items: fields }],
      },
    ],
    footer: [
      {
        content: [{ type: "text", value: "熔断器将在预计时间后自动恢复" }],
      },
    ],
    timestamp: new Date(),
  };
}
