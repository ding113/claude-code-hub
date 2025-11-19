import type { ProxySession } from "./session";
import { RateLimitService } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { RateLimitError } from "./errors";
import { getResetInfo, getDailyResetTime } from "@/lib/rate-limit/time-utils";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";

export class ProxyRateLimitGuard {
  /**
   * 检查限流（用户层 + Key 层）
   *
   * 改进：不再返回 Response，而是抛出 RateLimitError
   * 让统一的 ProxyErrorHandler 处理错误响应和数据库日志
   */
  static async ensure(session: ProxySession): Promise<void> {
    const user = session.authState?.user;
    const key = session.authState?.key;

    if (!user || !key) return;

    // ========== 用户层限流检查 ==========

    // 1. 检查用户 RPM 限制
    const rpmCheck = await RateLimitService.checkUserRPM(user.id, user.rpm);
    if (!rpmCheck.allowed) {
      logger.warn(`[RateLimit] User RPM exceeded: user=${user.id}, ${rpmCheck.reason}`);

      // 计算重置时间（下一分钟开始）
      const resetTime = new Date(Date.now() + 60 * 1000).toISOString();

      // 获取国际化错误消息
      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_RPM_EXCEEDED, {
        current: String(rpmCheck.current || 0),
        limit: String(user.rpm),
        resetTime,
      });

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "rpm",
        rpmCheck.current || 0,
        user.rpm,
        resetTime,
        null
      );
    }

    // 2. 检查用户每日额度
    const dailyCheck = await RateLimitService.checkUserDailyCost(user.id, user.dailyQuota);
    if (!dailyCheck.allowed) {
      logger.warn(`[RateLimit] User daily limit exceeded: user=${user.id}, ${dailyCheck.reason}`);

      // 计算重置时间（明天 00:00）
      const resetTime = getDailyResetTime().toISOString();

      // 获取国际化错误消息
      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(
        locale,
        ERROR_CODES.RATE_LIMIT_DAILY_QUOTA_EXCEEDED,
        {
          current: (dailyCheck.current || 0).toFixed(4),
          limit: user.dailyQuota.toFixed(4),
          resetTime,
        }
      );

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "daily_quota",
        dailyCheck.current || 0,
        user.dailyQuota,
        resetTime,
        null
      );
    }

    // ========== Key 层限流检查 ==========

    // 3. 检查 Key 金额限制
    const costCheck = await RateLimitService.checkCostLimits(key.id, "key", {
      limit_5h_usd: key.limit5hUsd,
      limit_daily_usd: key.limitDailyUsd,
      daily_reset_mode: key.dailyResetMode,
      daily_reset_time: key.dailyResetTime,
      limit_weekly_usd: key.limitWeeklyUsd,
      limit_monthly_usd: key.limitMonthlyUsd,
    });

    if (!costCheck.allowed) {
      logger.warn(`[RateLimit] Key cost limit exceeded: key=${key.id}, ${costCheck.reason}`);

      // 解析限流类型、当前使用量、限制值和重置时间
      const { limitType, currentUsage, limitValue, resetTime } = this.parseCostLimitInfo(
        costCheck.reason!
      );

      // 获取国际化错误消息
      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const errorCode =
        limitType === "usd_5h"
          ? ERROR_CODES.RATE_LIMIT_5H_EXCEEDED
          : limitType === "usd_weekly"
            ? ERROR_CODES.RATE_LIMIT_WEEKLY_EXCEEDED
            : ERROR_CODES.RATE_LIMIT_MONTHLY_EXCEEDED;

      const message = await getErrorMessageServer(locale, errorCode, {
        current: currentUsage.toFixed(4),
        limit: limitValue.toFixed(4),
        resetTime,
      });

      throw new RateLimitError(
        "rate_limit_error",
        message,
        limitType,
        currentUsage,
        limitValue,
        resetTime,
        null
      );
    }

    // 4. 检查 Key 并发 Session 限制
    const sessionCheck = await RateLimitService.checkSessionLimit(
      key.id,
      "key",
      key.limitConcurrentSessions || 0
    );

    if (!sessionCheck.allowed) {
      logger.warn(`[RateLimit] Key session limit exceeded: key=${key.id}, ${sessionCheck.reason}`);

      // 解析当前并发数和限制值
      const { currentUsage, limitValue } = this.parseSessionLimitInfo(sessionCheck.reason!);

      // 并发限制没有固定的重置时间，使用当前时间
      const resetTime = new Date().toISOString();

      // 获取国际化错误消息
      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(
        locale,
        ERROR_CODES.RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED,
        {
          current: String(currentUsage),
          limit: String(limitValue),
        }
      );

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "concurrent_sessions",
        currentUsage,
        limitValue,
        resetTime,
        null
      );
    }
  }

  /**
   * 从 reason 字符串解析限流类型、使用量和重置时间
   *
   * 示例 reason:
   * - "Key 5小时消费上限已达到（15.2000/15）"
   * - "Key 周消费上限已达到（150.0000/150）"
   * - "Key 月消费上限已达到（500.0000/500）"
   */
  private static parseCostLimitInfo(reason: string): {
    limitType: "usd_5h" | "usd_weekly" | "usd_monthly";
    currentUsage: number;
    limitValue: number;
    resetTime: string;
  } {
    // 解析格式：（current/limit）
    const match = reason.match(/（([\d.]+)\/([\d.]+)）/);
    const currentUsage = match ? parseFloat(match[1]) : 0;
    const limitValue = match ? parseFloat(match[2]) : 0;

    if (reason.includes("5小时")) {
      // 5小时滚动窗口：重置时间是 5 小时后
      const resetTime = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
      return { limitType: "usd_5h", currentUsage, limitValue, resetTime };
    } else if (reason.includes("周")) {
      // 自然周：重置时间是下周一 00:00
      const resetInfo = getResetInfo("weekly");
      const resetTime = resetInfo.resetAt?.toISOString() || new Date().toISOString();
      return { limitType: "usd_weekly", currentUsage, limitValue, resetTime };
    } else {
      // 自然月：重置时间是下月 1 号 00:00
      const resetInfo = getResetInfo("monthly");
      const resetTime = resetInfo.resetAt?.toISOString() || new Date().toISOString();
      return { limitType: "usd_monthly", currentUsage, limitValue, resetTime };
    }
  }

  /**
   * 从 reason 字符串解析并发限制信息
   *
   * 示例 reason:
   * - "Key并发 Session 上限已达到（5/5）"
   */
  private static parseSessionLimitInfo(reason: string): {
    currentUsage: number;
    limitValue: number;
  } {
    // 解析格式：（current/limit）
    const match = reason.match(/（([\d.]+)\/([\d.]+)）/);
    const currentUsage = match ? parseFloat(match[1]) : 0;
    const limitValue = match ? parseFloat(match[2]) : 0;

    return { currentUsage, limitValue };
  }
}
