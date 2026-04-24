import { fromZonedTime } from "date-fns-tz";

/**
 * Convert date strings (YYYY-MM-DD) to timestamps using a given timezone.
 * startTime = midnight of startDate in the timezone.
 * endTime = midnight of the day AFTER endDate (exclusive upper bound).
 */
export function parseDateRangeToTimestamps(
  startDate?: string,
  endDate?: string,
  timezone?: string
): { startTime?: number; endTime?: number } {
  const tz = timezone ?? "UTC";
  let startTime: number | undefined;
  let endTime: number | undefined;

  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    startTime = fromZonedTime(`${startDate}T00:00:00`, tz).getTime();
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
    if (match) {
      const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      next.setUTCDate(next.getUTCDate() + 1);
      const nextStr = next.toISOString().slice(0, 10);
      endTime = fromZonedTime(`${nextStr}T00:00:00`, tz).getTime();
    }
  }

  return { startTime, endTime };
}
