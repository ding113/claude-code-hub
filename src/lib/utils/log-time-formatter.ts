/**
 * 日志时间格式化工具
 * 将 Unix 时间戳(毫秒)转换为用户本地时间
 */

/**
 * 格式化日志时间戳为本地时间
 * @param timestamp Unix 时间戳(毫秒)
 * @param timezone 可选的时区,默认使用系统时区
 * @returns 格式化后的时间字符串,格式: YYYY/MM/DD HH:mm
 */
export function formatLogTime(timestamp: number, timezone?: string): string {
  try {
    const date = new Date(timestamp);

    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      return "Invalid Date";
    }

    // 使用 Intl.DateTimeFormat 进行时区转换和格式化
    const formatter = new Intl.DateTimeFormat("zh-CN", {
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
    console.error("Failed to format log time:", error);
    return new Date(timestamp).toLocaleString();
  }
}

/**
 * 批量格式化日志对象中的时间字段
 * @param logs 日志对象数组
 * @param timezone 可选的时区
 * @returns 格式化后的日志数组
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
