/**
 * Timezone-aware formatting for spreadsheet exports.
 *
 * Timestamps are rendered in the system timezone (resolved by the caller via
 * resolveSystemTimezone) instead of UTC, and the timezone is surfaced once in
 * the column header so each cell stays a clean, Excel-parseable datetime.
 */

import { formatInTimeZone } from "date-fns-tz";

/** Excel-friendly local datetime, e.g. "2026-06-03 20:34:56". */
export const EXPORT_DATETIME_FORMAT = "yyyy-MM-dd HH:mm:ss";

/**
 * Narrow to a usable Date. `new Date(NaN)` is still `instanceof Date`, so an
 * `instanceof` check alone would let an invalid date reach `formatInTimeZone`
 * and throw a RangeError mid-export.
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Render an instant as a wall-clock string in the given IANA timezone. */
export function formatExportTimestamp(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, EXPORT_DATETIME_FORMAT);
}

/**
 * Convert a UTC instant into a Date whose UTC fields equal the wall-clock time
 * in `timezone`. The XLSX writer derives the Excel serial from this Date's UTC
 * epoch value (see ./xlsx excelSerial), so the cell displays the intended local
 * time while remaining a real (sortable, computable) Excel date.
 */
export function toExcelZonedDate(date: Date, timezone: string): Date {
  const parts = formatInTimeZone(date, timezone, "yyyy-MM-dd-HH-mm-ss").split("-").map(Number);
  const [year, month, day, hour, minute, second] = parts;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}
