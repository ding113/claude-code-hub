import { formatInTimeZone } from "date-fns-tz";

/**
 * Format date-time for webhook messages.
 * Uses ISO-like format (yyyy/MM/dd HH:mm:ss) for consistency across locales.
 *
 * @param date - Date object or ISO string to format
 * @param timezone - IANA timezone identifier (required, use resolveSystemTimezone() for system default)
 * @returns Formatted datetime string in the specified timezone
 *
 * @example
 * formatDateTime(new Date(), "Asia/Shanghai") // "2024/01/15 14:30:00"
 */
export function formatDateTime(date: Date | string, timezone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, timezone, "yyyy/MM/dd HH:mm:ss");
}

/**
 * Alias for formatDateTime for backward compatibility
 */
export function formatTimestamp(date: Date, timezone: string): string {
  return formatDateTime(date, timezone);
}
