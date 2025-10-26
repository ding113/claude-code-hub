import type { ProxySession } from "./session";
import { RateLimitService } from "@/lib/rate-limit";

export class ProxyRateLimitGuard {
  /**
   * 检查 Key 限流
   */
  static async ensure(session: ProxySession): Promise<Response | null> {
    const key = session.authState?.key;
    if (!key) return null;

    // 1. 检查金额限制
    const costCheck = await RateLimitService.checkCostLimits(key.id, "key", {
      limit_5h_usd: key.limit5hUsd,
      limit_weekly_usd: key.limitWeeklyUsd,
      limit_monthly_usd: key.limitMonthlyUsd,
    });

    if (!costCheck.allowed) {
      return this.buildRateLimitResponse(key.id, "key", costCheck.reason!);
    }

    // 2. 检查并发 Session 限制
    const sessionCheck = await RateLimitService.checkSessionLimit(
      key.id,
      "key",
      key.limitConcurrentSessions || 0
    );

    if (!sessionCheck.allowed) {
      return this.buildRateLimitResponse(key.id, "key", sessionCheck.reason!);
    }

    return null;
  }

  /**
   * 构建 429 响应
   */
  private static buildRateLimitResponse(
    id: number,
    type: "key" | "provider",
    reason: string
  ): Response {
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-RateLimit-Type": type,
      "Retry-After": "3600", // 1 小时后重试
    });

    return new Response(
      JSON.stringify({
        error: {
          type: "rate_limit_error",
          message: reason,
        },
      }),
      {
        status: 429,
        headers,
      }
    );
  }
}
