/**
 * 日志时间格式化工具
 * 将 Unix 时间戳(毫秒)转换为用户本地时间
 */

import { logger } from "@/lib/logger";

/**
 * 格式化日志时间戳为本地时间
 * @param timestamp Unix 时间戳(毫秒)
 * @param timezone 可选的时区,默认使用系统时区
 * @returns 格式化后的时间字符串,格式: YYYY/MM/DD HH:mm
 *
 * @example
 * // 使用系统时区
 * formatLogTime(1640000000000) // "2021/12/20 16:53"
 *
 * @example
 * // 指定时区
 * formatLogTime(1640000000000, "America/New_York") // "2021/12/20 03:53"
 * formatLogTime(1640000000000, "Asia/Shanghai") // "2021/12/20 16:53"
 */
export function formatLogTime(timestamp: number, timezone?: string): string {
  try {
    const date = new Date(timestamp);

    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      return "Invalid Date";
    }

    // 使用 Intl.DateTimeFormat 进行时区转换和格式化
    // 使用 undefined 作为 locale 以使用运行时的默认区域设置，提高通用性
    const formatter = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || undefined, // undefined 使用系统时区
    });

    const parts = formatter.formatToParts(date);
    const partsMap = new Map(parts.map((p) => [p.type, p.value]));

    const year = partsMap.get("year");
    const month = partsMap.get("month");
    const day = partsMap.get("day");
    const hour = partsMap.get("hour");
    const minute = partsMap.get("minute");

    return `${year}/${month}/${day} ${hour}:${minute}`;
  } catch (error) {
    // 使用 logger 保持日志记录一致性
    logger.error("Failed to format log time:", error);
    // 使用 toISOString() 作为回退，提供明确的 ISO 8601 格式
    return new Date(timestamp).toISOString();
  }
}

/**
 * 批量格式化日志对象中的时间字段
 * @param logs 日志对象数组
 * @param timezone 可选的时区
 * @returns 格式化后的日志数组
 *
 * @example
 * const logs = [{ time: 1640000000000, message: "Error" }];
 * formatLogTimes(logs, "Asia/Shanghai");
 * // [{ time: 1640000000000, message: "Error", formattedTime: "2021/12/20 16:53" }]
 */
export function formatLogTimes<T extends { time?: number }>(
  logs: T[],
  timezone?: string
): (T & { formattedTime?: string })[] {
  return logs.map((log) => ({
    ...log,
    formattedTime: log.time ? formatLogTime(log.time, timezone) : undefined,
  }));
}

/**
 * 从环境变量或用户设置获取时区
 * @returns 时区字符串,如 'Asia/Shanghai'
 */
export function getUserTimezone(): string | undefined {
  // 优先使用环境变量 TZ
  if (process.env.TZ) {
    return process.env.TZ;
  }

  // 浏览器环境下使用 Intl API 获取用户时区
  if (typeof window !== "undefined") {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
