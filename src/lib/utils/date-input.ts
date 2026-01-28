import { parse } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

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

  // ISO datetime or other formats: parse and treat as timezone local time
  const localDate = new Date(input);

  if (Number.isNaN(localDate.getTime())) {
    throw new Error(`Invalid date input: ${input}`);
  }

  // Convert from timezone local time to UTC
  return fromZonedTime(localDate, timezone);
}
