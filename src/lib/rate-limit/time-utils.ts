/**
 * 时间工具函数
 * 用于计算自然时间窗口（周一/月初）和对应的 TTL
 */

import { startOfMonth, startOfWeek, addMonths, addWeeks, addDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { getEnvConfig } from "@/lib/config";

export type TimePeriod = "5h" | "weekly" | "monthly";

export interface TimeRange {
  startTime: Date;
  endTime: Date;
}

export interface ResetInfo {
  type: "rolling" | "natural";
  resetAt?: Date; // 自然时间窗口的重置时间
  period?: string; // 滚动窗口的周期描述
}

/**
 * 根据周期计算时间范围
 * - 5h: 滚动窗口（过去 5 小时）
 * - weekly: 自然周（本周一 00:00 到现在）
 * - monthly: 自然月（本月 1 号 00:00 到现在）
 *
 * 所有自然时间窗口使用配置的时区（Asia/Shanghai）
 */
export function getTimeRangeForPeriod(period: TimePeriod): TimeRange {
  const timezone = getEnvConfig().TZ; // 'Asia/Shanghai'
  const now = new Date();
  const endTime = now;
  let startTime: Date;

  switch (period) {
    case "5h":
      // 滚动窗口：过去 5 小时
      startTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      break;

    case "weekly": {
      // 自然周：本周一 00:00 (Asia/Shanghai)
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 }); // 周一
      startTime = fromZonedTime(zonedStartOfWeek, timezone);
      break;
    }

    case "monthly": {
      // 自然月：本月 1 号 00:00 (Asia/Shanghai)
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfMonth = startOfMonth(zonedNow);
      startTime = fromZonedTime(zonedStartOfMonth, timezone);
      break;
    }
  }

  return { startTime, endTime };
}

/**
 * 根据周期计算 Redis Key 的 TTL（秒）
 * - 5h: 5 小时（固定）
 * - weekly: 到下周一 00:00 的秒数
 * - monthly: 到下月 1 号 00:00 的秒数
 */
export function getTTLForPeriod(period: TimePeriod): number {
  const timezone = getEnvConfig().TZ;
  const now = new Date();

  switch (period) {
    case "5h":
      return 5 * 3600; // 5 小时

    case "weekly": {
      // 计算到下周一 00:00 的秒数
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
      const zonedNextWeek = addWeeks(zonedStartOfWeek, 1);
      const nextWeek = fromZonedTime(zonedNextWeek, timezone);

      return Math.ceil((nextWeek.getTime() - now.getTime()) / 1000);
    }

    case "monthly": {
      // 计算到下月 1 号 00:00 的秒数
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfMonth = startOfMonth(zonedNow);
      const zonedNextMonth = addMonths(zonedStartOfMonth, 1);
      const nextMonth = fromZonedTime(zonedNextMonth, timezone);

      return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
    }
  }
}

/**
 * 获取重置信息（用于前端展示）
 */
export function getResetInfo(period: TimePeriod): ResetInfo {
  const timezone = getEnvConfig().TZ;
  const now = new Date();

  switch (period) {
    case "5h":
      return {
        type: "rolling",
        period: "5 小时",
      };

    case "weekly": {
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
      const zonedNextWeek = addWeeks(zonedStartOfWeek, 1);
      const resetAt = fromZonedTime(zonedNextWeek, timezone);

      return {
        type: "natural",
        resetAt,
      };
    }

    case "monthly": {
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfMonth = startOfMonth(zonedNow);
      const zonedNextMonth = addMonths(zonedStartOfMonth, 1);
      const resetAt = fromZonedTime(zonedNextMonth, timezone);

      return {
        type: "natural",
        resetAt,
      };
    }
  }
}

/**
 * 计算距离午夜的秒数（用于每日限额）
 * 使用配置的时区（Asia/Shanghai）而非服务器本地时区
 */
export function getSecondsUntilMidnight(): number {
  const timezone = getEnvConfig().TZ;
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);
  const zonedTomorrow = addDays(zonedNow, 1);
  const zonedTomorrowStart = fromZonedTime(
    new Date(
      zonedTomorrow.getFullYear(),
      zonedTomorrow.getMonth(),
      zonedTomorrow.getDate(),
      0,
      0,
      0,
      0
    ),
    timezone
  );

  return Math.ceil((zonedTomorrowStart.getTime() - now.getTime()) / 1000);
}

/**
 * 获取每日限额的重置时间
 */
export function getDailyResetTime(): Date {
  const timezone = getEnvConfig().TZ;
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);
  const zonedTomorrow = addDays(zonedNow, 1);

  return fromZonedTime(
    new Date(
      zonedTomorrow.getFullYear(),
      zonedTomorrow.getMonth(),
      zonedTomorrow.getDate(),
      0,
      0,
      0,
      0
    ),
    timezone
  );
}
