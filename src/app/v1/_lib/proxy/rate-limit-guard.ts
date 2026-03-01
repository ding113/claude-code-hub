import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit";
import { resolveKeyUserConcurrentSessionLimits } from "@/lib/rate-limit/concurrent-session-limit";
import {
  resolveConcurrentUaIdentity,
  resolveKeyUserConcurrentUaLimits,
} from "@/lib/rate-limit/concurrent-ua-limit";
import { getResetInfo, getResetInfoWithMode } from "@/lib/rate-limit/time-utils";
import { SessionManager } from "@/lib/session-manager";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";
import { RateLimitError } from "./errors";
import type { ProxySession } from "./session";

/**
 * 通用的限额信息解析函数
 * 从错误原因字符串中提取当前使用量和限制值
 * 支持两种格式：
 * - checkCostLimits: （current/limit）
 * - checkCostLimitsWithLease: (usage: current/limit)
 */
function parseLimitInfo(reason: string): { currentUsage: number; limitValue: number } {
  // 匹配 checkCostLimits 格式：（current/limit）
  let match = reason.match(/（([\d.]+)\/([\d.]+)）/);
  if (match) {
    return { currentUsage: parseFloat(match[1]), limitValue: parseFloat(match[2]) };
  }

  // 匹配 checkCostLimitsWithLease 格式：(usage: current/limit)
  match = reason.match(/\(usage:\s*([\d.]+)\/([\d.]+)\)/);
  if (match) {
    return { currentUsage: parseFloat(match[1]), limitValue: parseFloat(match[2]) };
  }

  return { currentUsage: 0, limitValue: 0 };
}

/**
 * 限流守卫：集中执行 Key/User 各维度限额校验（含并发 Session / RPM 等资源保护）。
 *
 * 调用时机：`ProxySessionGuard` 分配 sessionId 之后、转发到上游之前。
 */
export class ProxyRateLimitGuard {
  /**
   * 检查限流（Key 层 + User 层）
   *
   * 检查顺序（基于 Codex 专业分析）：
   * 1-2. 永久硬限制：Key 总限额 → User 总限额
   * 3-5. 资源/频率保护：Key/User 并发 UA → Key/User 并发 Session → User RPM
   * 6-9. 短期周期限额：Key 5h → User 5h → Key 每日 → User 每日
   * 10-13. 中长期周期限额：Key 周 → User 周 → Key 月 → User 月
   *
   * 设计原则：
   * - 硬上限优先于周期上限
   * - 同一窗口内 Key → User 交替
   * - 资源/频率保护足够靠前
   * - 高触发概率窗口优先
   */
  static async ensure(session: ProxySession): Promise<void> {
    const user = session.authState?.user;
    const key = session.authState?.key;

    if (!user || !key) return;

    // ========== 第一层：永久硬限制 ==========

    // 1. Key 总限额（用户明确要求优先检查）
    const keyTotalCheck = await RateLimitService.checkTotalCostLimit(
      key.id,
      "key",
      key.limitTotalUsd ?? null,
      { keyHash: key.key }
    );

    if (!keyTotalCheck.allowed) {
      logger.warn(`[RateLimit] Key total limit exceeded: key=${key.id}, ${keyTotalCheck.reason}`);

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_TOTAL_EXCEEDED, {
        current: (keyTotalCheck.current || 0).toFixed(4),
        limit: (key.limitTotalUsd || 0).toFixed(4),
      });

      const noReset = "9999-12-31T23:59:59.999Z";

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_total",
        keyTotalCheck.current || 0,
        key.limitTotalUsd || 0,
        noReset,
        null
      );
    }

    // 2. User 总限额（账号级永久预算）
    const userTotalCheck = await RateLimitService.checkTotalCostLimit(
      user.id,
      "user",
      user.limitTotalUsd ?? null
    );

    if (!userTotalCheck.allowed) {
      logger.warn(
        `[RateLimit] User total limit exceeded: user=${user.id}, ${userTotalCheck.reason}`
      );

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_TOTAL_EXCEEDED, {
        current: (userTotalCheck.current || 0).toFixed(4),
        limit: (user.limitTotalUsd || 0).toFixed(4),
      });

      const noReset = "9999-12-31T23:59:59.999Z";

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_total",
        userTotalCheck.current || 0,
        user.limitTotalUsd || 0,
        noReset,
        null
      );
    }

    // ========== 第二层：资源/频率保护 ==========

    // 3. Key/User 并发 UA（用于限制“同时活跃的客户端/UA 数量”）
    // Key 未设置时，继承 User 并发上限（避免 UI/心智模型不一致）
    const {
      effectiveKeyLimit: effectiveKeyUaConcurrentLimit,
      normalizedUserLimit: normalizedUserUaConcurrentLimit,
    } = resolveKeyUserConcurrentUaLimits(key.limitConcurrentUas ?? 0, user.limitConcurrentUas);

    const { id: uaId } = resolveConcurrentUaIdentity(session.userAgent);

    const uaConcurrentCheck = await RateLimitService.checkAndTrackKeyUserUa(
      key.id,
      user.id,
      uaId,
      effectiveKeyUaConcurrentLimit,
      normalizedUserUaConcurrentLimit
    );

    if (!uaConcurrentCheck.allowed) {
      const rejectedBy = uaConcurrentCheck.rejectedBy ?? "key";
      const fallbackCurrentUsage =
        rejectedBy === "user" ? uaConcurrentCheck.userCount : uaConcurrentCheck.keyCount;
      const fallbackLimitValue =
        rejectedBy === "user" ? normalizedUserUaConcurrentLimit : effectiveKeyUaConcurrentLimit;
      const currentUsage = Number(uaConcurrentCheck.reasonParams?.current);
      const limitValue = Number(uaConcurrentCheck.reasonParams?.limit);
      const resolvedCurrentUsage = Number.isFinite(currentUsage)
        ? currentUsage
        : fallbackCurrentUsage;
      const resolvedLimitValue = Number.isFinite(limitValue) ? limitValue : fallbackLimitValue;

      logger.warn(
        `[RateLimit] ${rejectedBy === "user" ? "User" : "Key"} UA limit exceeded: key=${key.id}, user=${user.id}, current=${resolvedCurrentUsage}, limit=${resolvedLimitValue}`
      );

      const resetTime = new Date().toISOString();

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(
        locale,
        uaConcurrentCheck.reasonCode ?? ERROR_CODES.RATE_LIMIT_CONCURRENT_UAS_EXCEEDED,
        {
          current: String(resolvedCurrentUsage),
          limit: String(resolvedLimitValue),
        }
      );

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "concurrent_uas",
        resolvedCurrentUsage,
        resolvedLimitValue,
        resetTime,
        null
      );
    }

    // 4. Key 并发 Session（避免创建上游连接）
    // Key 未设置时，继承 User 并发上限（避免 UI/心智模型不一致：User 设置了并发，但 Key 仍显示“无限制”）
    const {
      effectiveKeyLimit: effectiveKeyConcurrentLimit,
      normalizedUserLimit: normalizedUserConcurrentLimit,
    } = resolveKeyUserConcurrentSessionLimits(
      key.limitConcurrentSessions ?? 0,
      user.limitConcurrentSessions
    );

    // 注意：并发 Session 限制必须“原子性检查 + 追踪”，否则会被并发击穿（尤其是多 Key 同时使用时）
    // 理论上 session guard 一定会分配 sessionId；这里兜底生成，避免降级回非原子路径
    const ensuredSessionId = session.sessionId || SessionManager.generateSessionId();
    if (!session.sessionId) {
      logger.warn(
        `[RateLimit] SessionId missing in rate-limit-guard, using fallback: key=${key.id}, user=${user.id} (potential atomicity gap)`
      );
      session.setSessionId(ensuredSessionId);
    }

    const concurrentCheck = await RateLimitService.checkAndTrackKeyUserSession(
      key.id,
      user.id,
      ensuredSessionId,
      effectiveKeyConcurrentLimit,
      normalizedUserConcurrentLimit
    );

    if (!concurrentCheck.allowed) {
      const rejectedBy = concurrentCheck.rejectedBy ?? "key";
      const fallbackCurrentUsage =
        rejectedBy === "user" ? concurrentCheck.userCount : concurrentCheck.keyCount;
      const fallbackLimitValue =
        rejectedBy === "user" ? normalizedUserConcurrentLimit : effectiveKeyConcurrentLimit;
      const currentUsage = Number(concurrentCheck.reasonParams?.current);
      const limitValue = Number(concurrentCheck.reasonParams?.limit);
      const resolvedCurrentUsage = Number.isFinite(currentUsage)
        ? currentUsage
        : fallbackCurrentUsage;
      const resolvedLimitValue = Number.isFinite(limitValue) ? limitValue : fallbackLimitValue;

      logger.warn(
        `[RateLimit] ${rejectedBy === "user" ? "User" : "Key"} session limit exceeded: key=${key.id}, user=${user.id}, current=${resolvedCurrentUsage}, limit=${resolvedLimitValue}`
      );

      const resetTime = new Date().toISOString();

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(
        locale,
        concurrentCheck.reasonCode ?? ERROR_CODES.RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED,
        {
          current: String(resolvedCurrentUsage),
          limit: String(resolvedLimitValue),
        }
      );

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "concurrent_sessions",
        resolvedCurrentUsage,
        resolvedLimitValue,
        resetTime,
        null
      );
    }

    // 5. User RPM（频率闸门，挡住高频噪声）- null/0 表示无限制
    if (user.rpm != null && user.rpm > 0) {
      const rpmCheck = await RateLimitService.checkRpmLimit(user.id, "user", user.rpm);
      if (!rpmCheck.allowed) {
        logger.warn(`[RateLimit] User RPM exceeded: user=${user.id}, ${rpmCheck.reason}`);

        const resetTime = new Date(Date.now() + 60 * 1000).toISOString();

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
    }

    // ========== 第三层：短期周期限额（混合检查）==========

    // 6. Key 5h 限额（最短周期，最易触发）
    const key5hCheck = await RateLimitService.checkCostLimitsWithLease(key.id, "key", {
      limit_5h_usd: key.limit5hUsd,
      limit_daily_usd: null, // 仅检查 5h
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    if (!key5hCheck.allowed) {
      logger.warn(`[RateLimit] Key 5h limit exceeded: key=${key.id}, ${key5hCheck.reason}`);

      const { currentUsage, limitValue } = parseLimitInfo(key5hCheck.reason!);

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      // 5h 是滚动窗口，使用专用的滚动窗口错误消息（无固定重置时间）
      const message = await getErrorMessageServer(
        locale,
        ERROR_CODES.RATE_LIMIT_5H_ROLLING_EXCEEDED,
        {
          current: currentUsage.toFixed(4),
          limit: limitValue.toFixed(4),
        }
      );

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_5h",
        currentUsage,
        limitValue,
        null, // 滚动窗口没有固定重置时间
        null
      );
    }

    // 7. User 5h 限额（防止多 Key 合力在短窗口打爆用户）
    const user5hCheck = await RateLimitService.checkCostLimitsWithLease(user.id, "user", {
      limit_5h_usd: user.limit5hUsd ?? null,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    if (!user5hCheck.allowed) {
      logger.warn(`[RateLimit] User 5h limit exceeded: user=${user.id}, ${user5hCheck.reason}`);

      const { currentUsage, limitValue } = parseLimitInfo(user5hCheck.reason!);

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      // 5h 是滚动窗口，使用专用的滚动窗口错误消息（无固定重置时间）
      const message = await getErrorMessageServer(
        locale,
        ERROR_CODES.RATE_LIMIT_5H_ROLLING_EXCEEDED,
        {
          current: currentUsage.toFixed(4),
          limit: limitValue.toFixed(4),
        }
      );

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_5h",
        currentUsage,
        limitValue,
        null, // 滚动窗口没有固定重置时间
        null
      );
    }

    // 8. Key 每日限额（Key 独有的每日预算）- null 表示无限制
    const keyDailyCheck = await RateLimitService.checkCostLimitsWithLease(key.id, "key", {
      limit_5h_usd: null,
      limit_daily_usd: key.limitDailyUsd,
      daily_reset_mode: key.dailyResetMode,
      daily_reset_time: key.dailyResetTime,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    if (!keyDailyCheck.allowed) {
      logger.warn(`[RateLimit] Key daily limit exceeded: key=${key.id}, ${keyDailyCheck.reason}`);

      const { currentUsage, limitValue } = parseLimitInfo(keyDailyCheck.reason!);

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();

      // 根据模式选择不同的错误消息
      if (key.dailyResetMode === "rolling") {
        // rolling 模式：使用滚动窗口专用消息（无固定重置时间）
        const message = await getErrorMessageServer(
          locale,
          ERROR_CODES.RATE_LIMIT_DAILY_ROLLING_EXCEEDED,
          {
            current: currentUsage.toFixed(4),
            limit: limitValue.toFixed(4),
          }
        );

        throw new RateLimitError(
          "rate_limit_error",
          message,
          "daily_quota",
          currentUsage,
          limitValue,
          null, // 滚动窗口没有固定重置时间
          null
        );
      } else {
        // fixed 模式：有固定重置时间
        const resetInfo = await getResetInfoWithMode(
          "daily",
          key.dailyResetTime,
          key.dailyResetMode
        );
        const resetTime =
          resetInfo.resetAt?.toISOString() ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const message = await getErrorMessageServer(
          locale,
          ERROR_CODES.RATE_LIMIT_DAILY_QUOTA_EXCEEDED,
          {
            current: currentUsage.toFixed(4),
            limit: limitValue.toFixed(4),
            resetTime,
          }
        );

        throw new RateLimitError(
          "rate_limit_error",
          message,
          "daily_quota",
          currentUsage,
          limitValue,
          resetTime,
          null
        );
      }
    }

    // 9. User 每日额度（User 独有的常用预算）- null 表示无限制
    // NOTE: 已迁移到 checkCostLimitsWithLease 以保持与其他周期限额的一致性
    const userDailyCheck = await RateLimitService.checkCostLimitsWithLease(user.id, "user", {
      limit_5h_usd: null, // 仅检查 daily
      limit_daily_usd: user.dailyQuota,
      daily_reset_time: user.dailyResetTime,
      daily_reset_mode: user.dailyResetMode,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    if (!userDailyCheck.allowed) {
      logger.warn(
        `[RateLimit] User daily limit exceeded: user=${user.id}, ${userDailyCheck.reason}`
      );

      const { currentUsage, limitValue } = parseLimitInfo(userDailyCheck.reason!);

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();

      // 根据模式选择不同的错误消息
      if (user.dailyResetMode === "rolling") {
        // rolling 模式：使用滚动窗口专用消息（无固定重置时间）
        const message = await getErrorMessageServer(
          locale,
          ERROR_CODES.RATE_LIMIT_DAILY_ROLLING_EXCEEDED,
          {
            current: currentUsage.toFixed(4),
            limit: limitValue.toFixed(4),
          }
        );

        throw new RateLimitError(
          "rate_limit_error",
          message,
          "daily_quota",
          currentUsage,
          limitValue,
          null, // 滚动窗口没有固定重置时间
          null
        );
      } else {
        // fixed 模式：有固定重置时间
        const resetInfo = await getResetInfoWithMode(
          "daily",
          user.dailyResetTime,
          user.dailyResetMode
        );
        const resetTime =
          resetInfo.resetAt?.toISOString() ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const message = await getErrorMessageServer(
          locale,
          ERROR_CODES.RATE_LIMIT_DAILY_QUOTA_EXCEEDED,
          {
            current: currentUsage.toFixed(4),
            limit: limitValue.toFixed(4),
            resetTime,
          }
        );

        throw new RateLimitError(
          "rate_limit_error",
          message,
          "daily_quota",
          currentUsage,
          limitValue,
          resetTime,
          null
        );
      }
    }

    // ========== 第四层：中长期周期限额（混合检查）==========

    // 10. Key 周限额
    const keyWeeklyCheck = await RateLimitService.checkCostLimitsWithLease(key.id, "key", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: key.limitWeeklyUsd,
      limit_monthly_usd: null,
    });

    if (!keyWeeklyCheck.allowed) {
      logger.warn(`[RateLimit] Key weekly limit exceeded: key=${key.id}, ${keyWeeklyCheck.reason}`);

      const { currentUsage, limitValue } = parseLimitInfo(keyWeeklyCheck.reason!);
      const resetInfo = await getResetInfo("weekly");
      const resetTime = resetInfo.resetAt?.toISOString() || new Date().toISOString();

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_WEEKLY_EXCEEDED, {
        current: currentUsage.toFixed(4),
        limit: limitValue.toFixed(4),
        resetTime,
      });

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_weekly",
        currentUsage,
        limitValue,
        resetTime,
        null
      );
    }

    // 11. User 周限额
    const userWeeklyCheck = await RateLimitService.checkCostLimitsWithLease(user.id, "user", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: user.limitWeeklyUsd ?? null,
      limit_monthly_usd: null,
    });

    if (!userWeeklyCheck.allowed) {
      logger.warn(
        `[RateLimit] User weekly limit exceeded: user=${user.id}, ${userWeeklyCheck.reason}`
      );

      const { currentUsage, limitValue } = parseLimitInfo(userWeeklyCheck.reason!);
      const resetInfo = await getResetInfo("weekly");
      const resetTime = resetInfo.resetAt?.toISOString() || new Date().toISOString();

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_WEEKLY_EXCEEDED, {
        current: currentUsage.toFixed(4),
        limit: limitValue.toFixed(4),
        resetTime,
      });

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_weekly",
        currentUsage,
        limitValue,
        resetTime,
        null
      );
    }

    // 12. Key 月限额
    const keyMonthlyCheck = await RateLimitService.checkCostLimitsWithLease(key.id, "key", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: key.limitMonthlyUsd,
    });

    if (!keyMonthlyCheck.allowed) {
      logger.warn(
        `[RateLimit] Key monthly limit exceeded: key=${key.id}, ${keyMonthlyCheck.reason}`
      );

      const { currentUsage, limitValue } = parseLimitInfo(keyMonthlyCheck.reason!);
      const resetInfo = await getResetInfo("monthly");
      const resetTime = resetInfo.resetAt?.toISOString() || new Date().toISOString();

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_MONTHLY_EXCEEDED, {
        current: currentUsage.toFixed(4),
        limit: limitValue.toFixed(4),
        resetTime,
      });

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_monthly",
        currentUsage,
        limitValue,
        resetTime,
        null
      );
    }

    // 13. User 月限额（最后一道长期预算闸门）
    const userMonthlyCheck = await RateLimitService.checkCostLimitsWithLease(user.id, "user", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: user.limitMonthlyUsd ?? null,
    });

    if (!userMonthlyCheck.allowed) {
      logger.warn(
        `[RateLimit] User monthly limit exceeded: user=${user.id}, ${userMonthlyCheck.reason}`
      );

      const { currentUsage, limitValue } = parseLimitInfo(userMonthlyCheck.reason!);
      const resetInfo = await getResetInfo("monthly");
      const resetTime = resetInfo.resetAt?.toISOString() || new Date().toISOString();

      const { getLocale } = await import("next-intl/server");
      const locale = await getLocale();
      const message = await getErrorMessageServer(locale, ERROR_CODES.RATE_LIMIT_MONTHLY_EXCEEDED, {
        current: currentUsage.toFixed(4),
        limit: limitValue.toFixed(4),
        resetTime,
      });

      throw new RateLimitError(
        "rate_limit_error",
        message,
        "usd_monthly",
        currentUsage,
        limitValue,
        resetTime,
        null
      );
    }
  }
}
