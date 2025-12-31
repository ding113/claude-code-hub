import type { NotificationJobType } from "@/lib/constants/notification.constants";
import type { StructuredMessage } from "../types";
import { buildCircuitBreakerMessage } from "./circuit-breaker";
import { buildCostAlertMessage } from "./cost-alert";
import { buildDailyLeaderboardMessage } from "./daily-leaderboard";

/**
 * 根据通知类型构建测试消息
 * 使用模拟数据，完整展示真实消息格式
 */
export function buildTestMessage(type: NotificationJobType): StructuredMessage {
  switch (type) {
    case "circuit-breaker":
      return buildCircuitBreakerMessage({
        providerName: "测试供应商",
        providerId: 0,
        failureCount: 3,
        retryAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        lastError: "Connection timeout (示例错误)",
      });

    case "cost-alert":
      return buildCostAlertMessage({
        targetType: "user",
        targetName: "测试用户",
        targetId: 0,
        currentCost: 80,
        quotaLimit: 100,
        threshold: 0.8,
        period: "本月",
      });

    case "daily-leaderboard":
      return buildDailyLeaderboardMessage({
        date: new Date().toISOString().split("T")[0],
        entries: [
          { userId: 1, userName: "用户A", totalRequests: 150, totalCost: 12.5, totalTokens: 50000 },
          { userId: 2, userName: "用户B", totalRequests: 120, totalCost: 10.2, totalTokens: 40000 },
        ],
        totalRequests: 270,
        totalCost: 22.7,
      });
  }
}
