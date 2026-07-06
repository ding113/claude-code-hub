import { format, subDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export interface ClockParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export function parseClockString(clockStr: string): ClockParts {
  const [hoursRaw, minutesRaw, secondsRaw] = clockStr.split(":");

  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw ?? "0");

  return {
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
    seconds: Number.isFinite(seconds) ? seconds : 0,
  };
}

export function formatClockFromTimestamp(timestamp: number, timeZone?: string): string {
  const baseDate = new Date(timestamp);
  const date = timeZone ? toZonedTime(baseDate, timeZone) : baseDate;
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function dateStringWithClockToTimestamp(
  dateStr: string,
  clockStr: string,
  timeZone?: string
): number | undefined {
  const [year, month, day] = dateStr.split("-").map(Number);
  const { hours, minutes, seconds } = parseClockString(clockStr);

  const baseDate = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  const date = timeZone ? fromZonedTime(baseDate, timeZone) : baseDate;
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return undefined;

  const validationDate = timeZone ? toZonedTime(date, timeZone) : date;
  if (validationDate.getFullYear() !== year) return undefined;
  if (validationDate.getMonth() !== month - 1) return undefined;
  if (validationDate.getDate() !== day) return undefined;

  return timestamp;
}

export function inclusiveEndTimestampFromExclusive(endExclusiveTimestamp: number): number {
  return Math.max(0, endExclusiveTimestamp - 1000);
}

export type QuickPeriod = "today" | "yesterday" | "last7days" | "last30days";

export function getQuickDateRange(
  period: QuickPeriod,
  timeZone?: string,
  now: Date = new Date()
): { startDate: string; endDate: string } {
  const baseDate = timeZone ? toZonedTime(now, timeZone) : now;
  const formatDate = (date: Date) => format(date, "yyyy-MM-dd");

  switch (period) {
    case "today":
      return {
        startDate: formatDate(baseDate),
        endDate: formatDate(baseDate),
      };
    case "yesterday": {
      const yesterday = subDays(baseDate, 1);
      return {
        startDate: formatDate(yesterday),
        endDate: formatDate(yesterday),
      };
    }
    case "last7days":
      return {
        startDate: formatDate(subDays(baseDate, 6)),
        endDate: formatDate(baseDate),
      };
    case "last30days":
      return {
        startDate: formatDate(subDays(baseDate, 29)),
        endDate: formatDate(baseDate),
      };
    default:
      return {
        startDate: formatDate(baseDate),
        endDate: formatDate(baseDate),
      };
  }
}
