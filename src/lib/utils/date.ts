import { formatInTimeZone } from "date-fns-tz";

/**
 * Convert a Date to an HTML datetime-local input value (YYYY-MM-DDTHH:mm)
 */
export function formatDateToDatetimeLocal(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Format a date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "刚刚";
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}分钟前`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}小时前`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return `${diffInDays}天前`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return `${diffInMonths}个月前`;
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return `${diffInYears}年前`;
}

/**
 * Format a date to string.
 * When a timezone is provided, uses formatInTimeZone for consistent display.
 */
export function formatDate(date: Date, locale = "zh-CN", timezone?: string): string {
  if (timezone) {
    return formatInTimeZone(date, timezone, "yyyy-MM-dd");
  }
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Format a date to datetime string.
 * When a timezone is provided, uses formatInTimeZone for consistent display.
 */
export function formatDateTime(date: Date, locale = "zh-CN", timezone?: string): string {
  if (timezone) {
    return formatInTimeZone(date, timezone, "yyyy-MM-dd HH:mm:ss");
  }
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
