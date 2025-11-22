/**
 * 时间工具函数
 * 用于计算自然时间窗口（周一/月初）和对应的 TTL
 */

import {
  startOfMonth,
  startOfWeek,
  addMonths,
  addWeeks,
  addDays,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { getEnvConfig } from "@/lib/config";

export type TimePeriod = "5h" | "daily" | "weekly" | "monthly";
export type DailyResetMode = "fixed" | "rolling";

export interface TimeRange {
  startTime: Date;
  endTime: Date;
}

export interface ResetInfo {
  type: "rolling" | "natural" | "custom";
  resetAt?: Date; // 自然/自定义时间窗口的重置时间
  period?: string; // 滚动窗口的周期描述
}

/**
 * 根据周期计算时间范围
 * - 5h: 滚动窗口（过去 5 小时）
 * - daily: 自定义每日重置时间到现在（需要额外的 resetTime 参数）
 * - weekly: 自然周（本周一 00:00 到现在）
 * - monthly: 自然月（本月 1 号 00:00 到现在）
 *
 * 所有自然时间窗口使用配置的时区（Asia/Shanghai）
 */
export function getTimeRangeForPeriod(period: TimePeriod, resetTime = "00:00"): TimeRange {
  const timezone = getEnvConfig().TZ; // 'Asia/Shanghai'
  const normalizedResetTime = normalizeResetTime(resetTime);
  const now = new Date();
  const endTime = now;
  let startTime: Date;

  switch (period) {
    case "5h":
      // 滚动窗口：过去 5 小时
      startTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      break;

    case "daily": {
      // 自定义每日重置时间（例如：18:00）
      startTime = getCustomDailyResetTime(now, normalizedResetTime, timezone);
      break;
    }

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
 * 根据周期和模式计算时间范围（支持滚动窗口模式）
 * - daily + rolling: 滚动窗口（过去 24 小时）
 * - daily + fixed: 固定时间重置（使用 resetTime）
 * - 其他周期：使用原有逻辑
 */
export function getTimeRangeForPeriodWithMode(
  period: TimePeriod,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): TimeRange {
  if (period === "daily" && mode === "rolling") {
    // 滚动窗口：过去 24 小时
    const now = new Date();
    return {
      startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endTime: now,
    };
  }

  // 其他情况使用原有逻辑
  return getTimeRangeForPeriod(period, resetTime);
}

/**
 * 根据周期计算 Redis Key 的 TTL（秒）
 * - 5h: 5 小时（固定）
 * - daily: 到下一个自定义重置时间的秒数
 * - weekly: 到下周一 00:00 的秒数
 * - monthly: 到下月 1 号 00:00 的秒数
 */
export function getTTLForPeriod(period: TimePeriod, resetTime = "00:00"): number {
  const timezone = getEnvConfig().TZ;
  const now = new Date();
  const normalizedResetTime = normalizeResetTime(resetTime);

  switch (period) {
    case "5h":
      return 5 * 3600; // 5 小时

    case "daily": {
      const nextReset = getNextDailyResetTime(now, normalizedResetTime, timezone);
      return Math.max(1, Math.ceil((nextReset.getTime() - now.getTime()) / 1000));
    }

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
 * 根据周期和模式计算 Redis Key 的 TTL（秒）
 * - daily + rolling: 24 小时（固定）
 * - daily + fixed: 到下一个自定义重置时间的秒数
 * - 其他周期：使用原有逻辑
 */
export function getTTLForPeriodWithMode(
  period: TimePeriod,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): number {
  if (period === "daily" && mode === "rolling") {
    return 24 * 3600; // 24 小时
  }

  return getTTLForPeriod(period, resetTime);
}

/**
 * 获取重置信息（用于前端展示）
 */
export function getResetInfo(period: TimePeriod, resetTime = "00:00"): ResetInfo {
  const timezone = getEnvConfig().TZ;
  const now = new Date();
  const normalizedResetTime = normalizeResetTime(resetTime);

  switch (period) {
    case "5h":
      return {
        type: "rolling",
        period: "5 小时",
      };

    case "daily": {
      const nextReset = getNextDailyResetTime(now, normalizedResetTime, timezone);
      return {
        type: "custom",
        resetAt: nextReset,
      };
    }

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
 * 获取重置信息（支持滚动窗口模式）
 */
export function getResetInfoWithMode(
  period: TimePeriod,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): ResetInfo {
  if (period === "daily" && mode === "rolling") {
    return {
      type: "rolling",
      period: "24 小时",
    };
  }

  return getResetInfo(period, resetTime);
}

function getCustomDailyResetTime(now: Date, resetTime: string, timezone: string): Date {
  const { hours, minutes } = parseResetTime(resetTime);
  const zonedNow = toZonedTime(now, timezone);
  const zonedResetToday = buildZonedDate(zonedNow, hours, minutes);
  const resetToday = fromZonedTime(zonedResetToday, timezone);

  if (now >= resetToday) {
    return resetToday;
  }

  return addDays(resetToday, -1);
}

function getNextDailyResetTime(now: Date, resetTime: string, timezone: string): Date {
  const { hours, minutes } = parseResetTime(resetTime);
  const zonedNow = toZonedTime(now, timezone);
  const zonedResetToday = buildZonedDate(zonedNow, hours, minutes);
  const resetToday = fromZonedTime(zonedResetToday, timezone);

  if (now < resetToday) {
    return resetToday;
  }

  const zonedNextDay = addDays(zonedResetToday, 1);
  return fromZonedTime(zonedNextDay, timezone);
}

function buildZonedDate(base: Date, hours: number, minutes: number): Date {
  const withHours = setHours(base, hours);
  const withMinutes = setMinutes(withHours, minutes);
  const withSeconds = setSeconds(withMinutes, 0);
  return setMilliseconds(withSeconds, 0);
}

function parseResetTime(resetTime: string): { hours: number; minutes: number } {
  const matches = /^([0-9]{1,2}):([0-9]{2})$/.exec(resetTime.trim());
  if (!matches) {
    return { hours: 0, minutes: 0 };
  }
  let hours = Number(matches[1]);
  let minutes = Number(matches[2]);

  if (Number.isNaN(hours) || hours < 0 || hours > 23) {
    hours = 0;
  }
  if (Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    minutes = 0;
  }

  return { hours, minutes };
}

export function normalizeResetTime(resetTime?: string): string {
  const { hours, minutes } = parseResetTime(resetTime ?? "00:00");
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
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
