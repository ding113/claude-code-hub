import { describe, expect, it } from "vitest";
import {
  buildTemplateVariables,
  getTemplatePlaceholders,
} from "@/lib/webhook/templates/placeholders";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("Webhook Template Placeholders", () => {
  it("getTemplatePlaceholders should return common placeholders by default", () => {
    const placeholders = getTemplatePlaceholders();
    const keys = placeholders.map((p) => p.key);
    expect(keys).toContain("{{timestamp}}");
    expect(keys).toContain("{{sections}}");
    // 仅 common：至少 5 个
    expect(placeholders.length).toBeGreaterThanOrEqual(5);
  });

  it("getTemplatePlaceholders should include type-specific placeholders", () => {
    const placeholders = getTemplatePlaceholders("cost_alert");
    const keys = placeholders.map((p) => p.key);
    expect(keys).toContain("{{timestamp}}");
    expect(keys).toContain("{{usage_percent}}");
  });

  it("buildTemplateVariables should build common and circuit_breaker variables", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "error" },
      sections: [
        {
          title: "信息",
          content: [
            { type: "text", value: "普通文本" },
            { type: "quote", value: "引用内容" },
            {
              type: "list",
              style: "ordered",
              items: [{ primary: "用户A", secondary: "消费 10" }],
            },
          ],
        },
      ],
      footer: [{ content: [{ type: "text", value: "footer" }] }],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const vars = buildTemplateVariables({
      message,
      notificationType: "circuit_breaker",
      data: {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        lastError: "timeout",
      },
    });

    expect(vars["{{title}}"]).toBe("标题");
    expect(vars["{{level}}"]).toBe("error");
    expect(vars["{{timestamp}}"]).toBe("2025-01-02T12:00:00.000Z");
    expect(vars["{{provider_name}}"]).toBe("OpenAI");
    expect(vars["{{provider_id}}"]).toBe("1");
    expect(vars["{{failure_count}}"]).toBe("3");
    expect(vars["{{retry_at}}"]).toBe("2025-01-02T13:00:00Z");
    expect(vars["{{last_error}}"]).toBe("timeout");
    expect(vars["{{sections}}"]).toContain("信息");
    expect(vars["{{sections}}"]).toContain("普通文本");
    expect(vars["{{sections}}"]).toContain("> 引用内容");
    expect(vars["{{sections}}"]).toContain("1. 用户A");
    expect(vars["{{sections}}"]).toContain("消费 10");
    expect(vars["{{sections}}"]).toContain("footer");
  });

  it("buildTemplateVariables should handle daily_leaderboard entries JSON stringify errors", () => {
    // 构造循环引用，验证 safeJsonStringify 降级
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const circular: any[] = [];
    circular.push(circular);

    const message: StructuredMessage = {
      header: { title: "排行榜", level: "info" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const vars = buildTemplateVariables({
      message,
      notificationType: "daily_leaderboard",
      data: {
        date: "2025-01-02",
        entries: circular,
        totalRequests: 10,
        totalCost: 1.23,
      },
    });

    expect(vars["{{date}}"]).toBe("2025-01-02");
    expect(vars["{{entries_json}}"]).toBe("[]");
    expect(vars["{{total_requests}}"]).toBe("10");
    expect(vars["{{total_cost}}"]).toBe("1.23");
  });

  it("buildTemplateVariables should compute usage percent for cost_alert", () => {
    const message: StructuredMessage = {
      header: { title: "成本预警", level: "warning" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const vars = buildTemplateVariables({
      message,
      notificationType: "cost_alert",
      data: { targetType: "user", targetName: "张三", currentCost: 80, quotaLimit: 100 },
    });

    expect(vars["{{target_type}}"]).toBe("user");
    expect(vars["{{target_name}}"]).toBe("张三");
    expect(vars["{{usage_percent}}"]).toBe("80.0");
  });

  it("buildTemplateVariables should return empty usage percent when quota is invalid", () => {
    const message: StructuredMessage = {
      header: { title: "成本预警", level: "warning" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const vars = buildTemplateVariables({
      message,
      notificationType: "cost_alert",
      data: { targetType: "user", targetName: "张三", currentCost: 80, quotaLimit: 0 },
    });

    expect(vars["{{usage_percent}}"]).toBe("");
  });
});
