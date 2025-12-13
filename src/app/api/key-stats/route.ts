import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { validateApiKeyAndGetUser } from "@/repository/key";
import { findKeysWithStatistics } from "@/repository/key";
import { sumUserCostToday } from "@/repository/statistics";
import { RateLimitService } from "@/lib/rate-limit";
import { getResetInfoWithMode } from "@/lib/rate-limit/time-utils";
import { SessionTracker } from "@/lib/session-tracker";

export const runtime = "nodejs";

/**
 * GET /api/key-stats
 *
 * Returns comprehensive statistics for the authenticated API key
 * Authentication: Authorization: Bearer sk-xxx
 *
 * Security: Only returns data for the specific key being used
 */
export async function GET(request: NextRequest) {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header. Use: Authorization: Bearer sk-xxx" },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7); // Remove "Bearer "

    // Validate key and get user in one query
    const result = await validateApiKeyAndGetUser(apiKey);
    if (!result) {
      return NextResponse.json({ error: "Invalid or expired API key" }, { status: 401 });
    }

    const { key, user } = result;

    // Get key statistics (model stats, usage counts, etc.)
    const allKeyStats = await findKeysWithStatistics(user.id);
    const thisKeyStats = allKeyStats.find((stat) => stat.keyId === key.id);

    // Get user's total cost today (across all keys)
    const userTotalCostToday = await sumUserCostToday(user.id);

    // Get key's current usage for different time windows and user usage
    const [
      cost5h,
      costDaily,
      costWeekly,
      costMonthly,
      concurrentSessions,
      userCost5h,
      userCostWeekly,
      userCostMonthly,
    ] = await Promise.all([
      RateLimitService.getCurrentCost(key.id, "key", "5h"),
      RateLimitService.getCurrentCost(
        key.id,
        "key",
        "daily",
        key.dailyResetTime,
        key.dailyResetMode ?? "fixed"
      ),
      RateLimitService.getCurrentCost(key.id, "key", "weekly"),
      RateLimitService.getCurrentCost(key.id, "key", "monthly"),
      SessionTracker.getKeySessionCount(key.id),
      RateLimitService.getCurrentCost(user.id, "user", "5h"),
      RateLimitService.getCurrentCost(user.id, "user", "weekly"),
      RateLimitService.getCurrentCost(user.id, "user", "monthly"),
    ]);

    // Get reset time information for daily limit
    const resetInfoDaily = getResetInfoWithMode(
      "daily",
      key.dailyResetTime,
      key.dailyResetMode ?? "fixed"
    );

    // Calculate remaining amounts
    const calculateRemaining = (limit: number | null, current: number) => {
      if (limit === null || limit === undefined) return null;
      return Math.max(0, limit - current);
    };

    // Return comprehensive stats
    return NextResponse.json({
      key: {
        id: key.id,
        name: key.name,
        isEnabled: key.isEnabled,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
        limits: {
          limit5hUsd: key.limit5hUsd,
          limitDailyUsd: key.limitDailyUsd,
          dailyResetMode: key.dailyResetMode ?? "fixed",
          dailyResetTime: key.dailyResetTime ?? "00:00",
          limitWeeklyUsd: key.limitWeeklyUsd,
          limitMonthlyUsd: key.limitMonthlyUsd,
          limitConcurrentSessions: key.limitConcurrentSessions,
        },
        usage: {
          cost5h: {
            current: cost5h,
            limit: key.limit5hUsd,
            remaining: calculateRemaining(key.limit5hUsd, cost5h),
          },
          costDaily: {
            current: costDaily,
            limit: key.limitDailyUsd,
            remaining: calculateRemaining(key.limitDailyUsd, costDaily),
            resetAt: resetInfoDaily.resetAt,
            resetMode: key.dailyResetMode ?? "fixed",
          },
          costWeekly: {
            current: costWeekly,
            limit: key.limitWeeklyUsd,
            remaining: calculateRemaining(key.limitWeeklyUsd, costWeekly),
          },
          costMonthly: {
            current: costMonthly,
            limit: key.limitMonthlyUsd,
            remaining: calculateRemaining(key.limitMonthlyUsd, costMonthly),
          },
          concurrentSessions: {
            current: concurrentSessions,
            limit: key.limitConcurrentSessions,
            remaining: Math.max(0, key.limitConcurrentSessions - concurrentSessions),
          },
        },
        statistics: thisKeyStats
          ? {
              todayCallCount: thisKeyStats.todayCallCount,
              lastUsedAt: thisKeyStats.lastUsedAt,
              lastProviderName: thisKeyStats.lastProviderName,
              modelStats: thisKeyStats.modelStats,
            }
          : {
              todayCallCount: 0,
              lastUsedAt: null,
              lastProviderName: null,
              modelStats: [],
            },
      },
      user: {
        id: user.id,
        name: user.name,
        description: user.description,
        role: user.role,
        providerGroup: user.providerGroup,
        createdAt: user.createdAt,
        limits: {
          rpm: user.rpm,
          dailyQuota: user.dailyQuota,
          limit5hUsd: user.limit5hUsd,
          limitWeeklyUsd: user.limitWeeklyUsd,
          limitMonthlyUsd: user.limitMonthlyUsd,
          limitConcurrentSessions: user.limitConcurrentSessions,
        },
        usage: {
          totalCostToday: userTotalCostToday,
          cost5h: userCost5h,
          costWeekly: userCostWeekly,
          costMonthly: userCostMonthly,
        },
      },
    });
  } catch (error) {
    logger.error("Key stats API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
