import { describe, expect, it } from "vitest";
import { buildCacheHitRateAlertMessage } from "@/lib/webhook/templates/cache-hit-rate-alert";
import { buildCircuitBreakerMessage } from "@/lib/webhook/templates/circuit-breaker";
import { buildCostAlertMessage } from "@/lib/webhook/templates/cost-alert";
import { buildDailyLeaderboardMessage } from "@/lib/webhook/templates/daily-leaderboard";
import type {
  CacheHitRateAlertData,
  CircuitBreakerAlertData,
  CostAlertData,
  DailyLeaderboardData,
} from "@/lib/webhook/types";

describe("Message Templates", () => {
  describe("buildCircuitBreakerMessage", () => {
    it("should create structured message for circuit breaker alert", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        lastError: "Connection timeout",
      };

      const message = buildCircuitBreakerMessage(data);

      expect(message.header.level).toBe("error");
      expect(message.header.icon).toBe("🔌");
      expect(message.header.title).toContain("熔断");
      expect(message.timestamp).toBeInstanceOf(Date);

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("OpenAI");
      expect(sectionsStr).toContain("5");
    });

    it("should handle missing lastError", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "Anthropic",
        providerId: 2,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
      };

      const message = buildCircuitBreakerMessage(data);
      expect(message.header.level).toBe("error");
    });

    it("should default to provider source when incidentSource is not set", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
      };

      const message = buildCircuitBreakerMessage(data);
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("OpenAI");
      // Default should use provider-style title
      expect(message.header.title).toMatch(/供应商/);
    });

    it("should produce provider-specific message when incidentSource is provider", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "Anthropic",
        providerId: 2,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "provider",
      };

      const message = buildCircuitBreakerMessage(data);
      expect(message.header.title).toMatch(/供应商/);
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("Anthropic");
      expect(sectionsStr).toContain("ID: 2");
    });

    it("should produce endpoint-specific message when incidentSource is endpoint", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
        endpointUrl: "https://api.openai.com/v1",
      };

      const message = buildCircuitBreakerMessage(data);
      expect(message.header.title).toMatch(/端点/);
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("42");
      expect(sectionsStr).toContain("https://api.openai.com/v1");
    });

    it("should include endpoint fields in details when source is endpoint", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        lastError: "Connection refused",
        incidentSource: "endpoint",
        endpointId: 99,
        endpointUrl: "https://custom-proxy.example.com/v1",
      };

      const message = buildCircuitBreakerMessage(data);
      const sectionsStr = JSON.stringify(message.sections);
      // Should still include failure count and error
      expect(sectionsStr).toContain("5");
      expect(sectionsStr).toContain("Connection refused");
      // Should include endpoint-specific info
      expect(sectionsStr).toContain("99");
      expect(sectionsStr).toContain("https://custom-proxy.example.com/v1");
    });
  });

  describe("buildCostAlertMessage", () => {
    it("should create structured message for user cost alert", () => {
      const data: CostAlertData = {
        targetType: "user",
        targetName: "张三",
        targetId: 100,
        currentCost: 8.5,
        quotaLimit: 10,
        threshold: 0.8,
        period: "本周",
      };

      const message = buildCostAlertMessage(data);

      expect(message.header.level).toBe("warning");
      expect(message.header.icon).toBe("💰");
      expect(message.header.title).toContain("成本预警");

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("张三");
      expect(sectionsStr).toContain("8.5");
      expect(sectionsStr).toContain("本周");
    });

    it("should create structured message for provider cost alert", () => {
      const data: CostAlertData = {
        targetType: "provider",
        targetName: "GPT-4",
        targetId: 1,
        currentCost: 950,
        quotaLimit: 1000,
        threshold: 0.9,
        period: "本月",
      };

      const message = buildCostAlertMessage(data);

      expect(message.header.level).toBe("warning");
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("供应商");
    });

    it("renders the model-group-only split when present (group-rate-limit §5.3/§10)", () => {
      const data: CostAlertData = {
        targetType: "user",
        targetName: "李四",
        targetId: 101,
        currentCost: 9,
        quotaLimit: 10,
        threshold: 0.8,
        period: "5小时",
        modelGroupOnlyCost: 15,
      };

      const message = buildCostAlertMessage(data);
      const sectionsStr = JSON.stringify(message.sections);

      expect(sectionsStr).toContain("模型组单算");
      expect(sectionsStr).toContain("计入全局额");
      expect(sectionsStr).toContain("15.0000"); // model-group-only portion
      expect(sectionsStr).toContain("24.0000"); // total = currentCost + modelGroupOnly
    });

    it("hides the split rows when there is no model-group-only spend", () => {
      const data: CostAlertData = {
        targetType: "user",
        targetName: "王五",
        targetId: 102,
        currentCost: 8,
        quotaLimit: 10,
        threshold: 0.8,
        period: "本月",
        modelGroupOnlyCost: 0,
      };

      const message = buildCostAlertMessage(data);
      const sectionsStr = JSON.stringify(message.sections);

      expect(sectionsStr).not.toContain("模型组单算");
      expect(sectionsStr).not.toContain("计入全局额");
    });
  });

  describe("buildDailyLeaderboardMessage", () => {
    it("should create structured message for leaderboard", () => {
      const data: DailyLeaderboardData = {
        date: "2025-01-02",
        entries: [
          { userId: 1, userName: "用户A", totalRequests: 100, totalCost: 5.0, totalTokens: 50000 },
          { userId: 2, userName: "用户B", totalRequests: 80, totalCost: 4.0, totalTokens: 40000 },
        ],
        totalRequests: 180,
        totalCost: 9.0,
      };

      const message = buildDailyLeaderboardMessage(data);

      expect(message.header.level).toBe("info");
      expect(message.header.icon).toBe("📊");
      expect(message.header.title).toContain("排行榜");

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("用户A");
      expect(sectionsStr).toContain("🥇");
    });

    it("should handle empty entries", () => {
      const data: DailyLeaderboardData = {
        date: "2025-01-02",
        entries: [],
        totalRequests: 0,
        totalCost: 0,
      };

      const message = buildDailyLeaderboardMessage(data);

      expect(message.header.level).toBe("info");
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("暂无数据");
    });
  });

  describe("buildCacheHitRateAlertMessage", () => {
    it("should create structured message for cache hit rate alert", () => {
      const data: CacheHitRateAlertData = {
        window: {
          mode: "5m",
          startTime: "2026-02-24T00:00:00.000Z",
          endTime: "2026-02-24T00:05:00.000Z",
          durationMinutes: 5,
        },
        anomalies: [
          {
            providerId: 1,
            providerName: "OpenAI",
            providerType: "openai-compatible",
            model: "gpt-4o",
            baselineSource: "historical",
            current: {
              kind: "eligible",
              requests: 100,
              denominatorTokens: 10000,
              hitRateTokens: 0.1,
            },
            baseline: {
              kind: "eligible",
              requests: 200,
              denominatorTokens: 20000,
              hitRateTokens: 0.5,
            },
            deltaAbs: -0.4,
            deltaRel: -0.8,
            dropAbs: 0.4,
            reasonCodes: ["abs_min"],
          },
        ],
        suppressedCount: 0,
        settings: {
          windowMode: "auto",
          checkIntervalMinutes: 5,
          historicalLookbackDays: 7,
          minEligibleRequests: 20,
          minEligibleTokens: 0,
          absMin: 0.05,
          dropRel: 0.3,
          dropAbs: 0.1,
          cooldownMinutes: 30,
          topN: 10,
        },
        generatedAt: "2026-02-24T00:05:00.000Z",
      };

      const message = buildCacheHitRateAlertMessage(data, "UTC");

      expect(message.header.level).toBe("warning");
      expect(message.header.icon).toBe("[CACHE]");
      expect(message.header.title).toContain("缓存命中率");
      expect(message.timestamp).toBeInstanceOf(Date);

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("OpenAI");
      expect(sectionsStr).toContain("gpt-4o");
      expect(sectionsStr).toContain("5m");
      expect(sectionsStr).toContain("异常列表");
    });

    it("should handle anomalies with null baseline", () => {
      const data: CacheHitRateAlertData = {
        window: {
          mode: "5m",
          startTime: "2026-02-24T00:00:00.000Z",
          endTime: "2026-02-24T00:05:00.000Z",
          durationMinutes: 5,
        },
        anomalies: [
          {
            providerId: 1,
            providerName: "OpenAI",
            providerType: "openai-compatible",
            model: "gpt-4o",
            baselineSource: null,
            current: {
              kind: "eligible",
              requests: 100,
              denominatorTokens: 10000,
              hitRateTokens: 0.1,
            },
            baseline: null,
            deltaAbs: null,
            deltaRel: null,
            dropAbs: null,
            reasonCodes: ["abs_min"],
          },
        ],
        suppressedCount: 0,
        settings: {
          windowMode: "auto",
          checkIntervalMinutes: 5,
          historicalLookbackDays: 7,
          minEligibleRequests: 20,
          minEligibleTokens: 0,
          absMin: 0.05,
          dropRel: 0.3,
          dropAbs: 0.1,
          cooldownMinutes: 30,
          topN: 10,
        },
        generatedAt: "2026-02-24T00:05:00.000Z",
      };

      const message = buildCacheHitRateAlertMessage(data, "UTC");

      expect(message.header.level).toBe("warning");
      expect(message.timestamp).toBeInstanceOf(Date);

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("gpt-4o");
      expect(sectionsStr).toContain("基线: 无");
    });

    it("should handle empty anomalies", () => {
      const data: CacheHitRateAlertData = {
        window: {
          mode: "30m",
          startTime: "2026-02-24T00:00:00.000Z",
          endTime: "2026-02-24T00:30:00.000Z",
          durationMinutes: 30,
        },
        anomalies: [],
        suppressedCount: 2,
        settings: {
          windowMode: "30m",
          checkIntervalMinutes: 5,
          historicalLookbackDays: 7,
          minEligibleRequests: 20,
          minEligibleTokens: 0,
          absMin: 0.05,
          dropRel: 0.3,
          dropAbs: 0.1,
          cooldownMinutes: 30,
          topN: 10,
        },
        generatedAt: "2026-02-24T00:30:00.000Z",
      };

      const message = buildCacheHitRateAlertMessage(data, "UTC");
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("未检测到异常");
      expect(sectionsStr).not.toContain("异常列表");
    });
  });
});
