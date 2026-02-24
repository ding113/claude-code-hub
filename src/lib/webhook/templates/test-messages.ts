import type { NotificationJobType } from "@/lib/constants/notification.constants";
import type { StructuredMessage } from "../types";
import { buildCacheHitRateAlertMessage } from "./cache-hit-rate-alert";
import { buildCircuitBreakerMessage } from "./circuit-breaker";
import { buildCostAlertMessage } from "./cost-alert";
import { buildDailyLeaderboardMessage } from "./daily-leaderboard";

/**
 * 根据通知类型构建测试消息
 * 使用模拟数据，完整展示真实消息格式
 *
 * @param type - Notification job type
 * @param timezone - IANA timezone identifier for date/time formatting (optional, defaults to UTC)
 */
export function buildTestMessage(type: NotificationJobType, timezone?: string): StructuredMessage {
  switch (type) {
    case "circuit-breaker":
      return buildCircuitBreakerMessage(
        {
          providerName: "测试供应商",
          providerId: 0,
          failureCount: 3,
          retryAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          lastError: "Connection timeout (示例错误)",
        },
        timezone
      );

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

    case "cache-hit-rate-alert":
      return buildCacheHitRateAlertMessage(
        {
          window: {
            mode: "5m",
            startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            endTime: new Date().toISOString(),
            durationMinutes: 5,
          },
          anomalies: [
            {
              providerId: 1,
              providerName: "测试供应商",
              providerType: "claude",
              model: "test-model",
              baselineSource: "historical",
              current: {
                kind: "eligible",
                requests: 100,
                denominatorTokens: 10000,
                hitRateTokens: 0.12,
              },
              baseline: {
                kind: "eligible",
                requests: 100,
                denominatorTokens: 10000,
                hitRateTokens: 0.45,
              },
              deltaAbs: -0.33,
              deltaRel: -0.7333,
              dropAbs: 0.33,
              reasonCodes: ["abs_min", "drop_abs_rel"],
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
          generatedAt: new Date().toISOString(),
        },
        timezone
      );
  }
}
