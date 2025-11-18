import type { ProxySession } from "./session";
import { RateLimitService } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export class ProxyRateLimitGuard {
  /**
   * 检查限流（用户层 + Key 层）
   */
  static async ensure(session: ProxySession): Promise<Response | null> {
    const user = session.authState?.user;
    const key = session.authState?.key;

    if (!user || !key) return null;

    // ========== 用户层限流检查 ==========

    // 1. 检查用户 RPM 限制
    const rpmCheck = await RateLimitService.checkUserRPM(user.id, user.rpm);
    if (!rpmCheck.allowed) {
      logger.warn(`[RateLimit] User RPM exceeded: user=${user.id}, ${rpmCheck.reason}`);
      return this.buildRateLimitResponse(user.id, "user", rpmCheck.reason!);
    }

    // 2. 检查用户每日额度
    const dailyCheck = await RateLimitService.checkUserDailyCost(user.id, user.dailyQuota);
    if (!dailyCheck.allowed) {
      logger.warn(`[RateLimit] User daily limit exceeded: user=${user.id}, ${dailyCheck.reason}`);
      return this.buildRateLimitResponse(user.id, "user", dailyCheck.reason!);
    }

    // ========== Key 层限流检查 ==========

    // 3. 检查 Key 金额限制
    const costCheck = await RateLimitService.checkCostLimits(key.id, "key", {
      limit_5h_usd: key.limit5hUsd,
      limit_daily_usd: key.limitDailyUsd,
      daily_reset_time: key.dailyResetTime,
      limit_weekly_usd: key.limitWeeklyUsd,
      limit_monthly_usd: key.limitMonthlyUsd,
    });

    if (!costCheck.allowed) {
      logger.warn(`[RateLimit] Key cost limit exceeded: key=${key.id}, ${costCheck.reason}`);
      return this.buildRateLimitResponse(key.id, "key", costCheck.reason!);
    }

    // 4. 检查 Key 并发 Session 限制
    const sessionCheck = await RateLimitService.checkSessionLimit(
      key.id,
      "key",
      key.limitConcurrentSessions || 0
    );

    if (!sessionCheck.allowed) {
      logger.warn(`[RateLimit] Key session limit exceeded: key=${key.id}, ${sessionCheck.reason}`);
      return this.buildRateLimitResponse(key.id, "key", sessionCheck.reason!);
    }

    return null; // ✅ 通过所有检查
  }

  /**
   * 构建 429 响应
   */
  private static buildRateLimitResponse(
    id: number,
    type: "user" | "key" | "provider",
    reason: string
  ): Response {
    const message = type === "user" ? `用户限流：${reason}` : `Key 限流：${reason}`;

    const headers = new Headers({
      "Content-Type": "application/json",
      "X-RateLimit-Type": type,
      "Retry-After": "3600", // 1 小时后重试
    });

    return new Response(
      JSON.stringify({
        error: {
          type: "rate_limit_error",
          message,
        },
      }),
      {
        status: 429,
        headers,
      }
    );
  }
}
