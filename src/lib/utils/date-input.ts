import { parse } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

const DATETIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?$/;
const DATETIME_WITH_TZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?([zZ]|[+-]\d{2}:?\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function hasValidCalendarDate(yearText: string, monthText: string, dayText: string): boolean {
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  return day >= 1 && day <= getDaysInMonth(year, month);
}

export function isValidDateTimeLocalString(input: string): boolean {
  const match = DATETIME_LOCAL_PATTERN.exec(input);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  return hasValidCalendarDate(yearText, monthText, dayText);
}

export function isValidDateTimeString(input: string): boolean {
  if (isValidDateTimeLocalString(input)) {
    return true;
  }

  const match = DATETIME_WITH_TZ_PATTERN.exec(input);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  if (!hasValidCalendarDate(yearText, monthText, dayText)) {
    return false;
  }

  return !Number.isNaN(new Date(input).getTime());
}

export function isFutureDate(date: Date, now: Date = new Date()): boolean {
  return date.getTime() > now.getTime();
}

/**
 * Parse a date string input and interpret it in the specified timezone.
 *
 * - Date-only (YYYY-MM-DD): Interprets as end-of-day (23:59:59) in timezone
 * - Full datetime: Interprets as local time in timezone
 *
 * Returns a UTC Date that represents the correct instant.
 *
 * @param input - Date string in YYYY-MM-DD or ISO datetime format
 * @param timezone - IANA timezone identifier (e.g., "Asia/Shanghai", "America/New_York")
 * @returns Date object in UTC representing the input interpreted in the given timezone
 * @throws Error if input is invalid
 *
 * @example
 * // "2024-12-31" in Asia/Shanghai becomes 2024-12-31 23:59:59 Shanghai = 2024-12-31 15:59:59 UTC
 * parseDateInputAsTimezone("2024-12-31", "Asia/Shanghai")
 *
 * @example
 * // "2024-12-31T10:30:00" in Asia/Shanghai becomes 2024-12-31 10:30:00 Shanghai = 2024-12-31 02:30:00 UTC
 * parseDateInputAsTimezone("2024-12-31T10:30:00", "Asia/Shanghai")
 */
export function parseDateInputAsTimezone(input: string, timezone: string): Date {
  if (!input) {
    throw new Error("Invalid date input: empty string");
  }

  // Date-only format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // Parse as end-of-day (23:59:59) in the given timezone
    const localDateTime = parse(`${input} 23:59:59`, "yyyy-MM-dd HH:mm:ss", new Date());

    if (Number.isNaN(localDateTime.getTime())) {
      throw new Error(`Invalid date input: ${input}`);
    }

    // Convert from timezone local time to UTC
    return fromZonedTime(localDateTime, timezone);
  }

  // Check if input has timezone designator (Z or +-HH:MM offset)
  // If so, parse directly as it already represents an absolute instant
  const hasTimezoneDesignator = /([zZ]|[+-]\d{2}:?\d{2})$/.test(input);
  if (hasTimezoneDesignator) {
    const directDate = new Date(input);
    if (Number.isNaN(directDate.getTime())) {
      throw new Error(`Invalid date input: ${input}`);
    }
    return directDate;
  }

  // ISO datetime without timezone: parse and treat as timezone local time
  const localDate = new Date(input);

  if (Number.isNaN(localDate.getTime())) {
    throw new Error(`Invalid date input: ${input}`);
  }

  // Convert from timezone local time to UTC
  return fromZonedTime(localDate, timezone);
}

/**
 * 将 Date 格式化为本地时区的 YYYY-MM-DD（用于 date-only 输入控件）。
 */
export function formatDateToLocalYmd(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 将 YYYY-MM-DD 的纯日期字符串解析为“本地时区当天结束时间”（23:59:59.999）。
 *
 * 注意：刻意避免 `new Date("YYYY-MM-DD")`，因为该形式在 JS 中按 UTC 解析，
 * 后续再转换为本地时间时可能出现日期偏差（提前/延后一日）。
 */
export function parseYmdToLocalEndOfDay(input: string): Date | null {
  if (!input) return null;
  const [year, month, day] = input.split("-").map((v) => Number(v));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date;
}
