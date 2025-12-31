import { describe, expect, it } from "vitest";
import { buildCircuitBreakerMessage } from "@/lib/webhook/templates/circuit-breaker";
import { buildCostAlertMessage } from "@/lib/webhook/templates/cost-alert";
import { buildDailyLeaderboardMessage } from "@/lib/webhook/templates/daily-leaderboard";
import type {
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
});
