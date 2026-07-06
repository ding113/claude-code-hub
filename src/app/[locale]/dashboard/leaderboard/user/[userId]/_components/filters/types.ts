import { format, subDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export type TimeRangePreset = "today" | "7days" | "30days" | "thisMonth";

export interface UserInsightsFilters {
  timeRange: TimeRangePreset;
  keyId?: number;
  providerId?: number;
  model?: string;
}

export const DEFAULT_FILTERS: UserInsightsFilters = {
  timeRange: "7days",
};

/**
 * Convert a time range preset to start/end dates for breakdown queries.
 */
export function resolveTimePresetDates(preset: TimeRangePreset): {
  startDate?: string;
  endDate?: string;
};
export function resolveTimePresetDates(
  preset: TimeRangePreset,
  timeZone: string | undefined,
  now?: Date
): {
  startDate?: string;
  endDate?: string;
};
export function resolveTimePresetDates(
  preset: TimeRangePreset,
  timeZone?: string,
  now: Date = new Date()
): {
  startDate?: string;
  endDate?: string;
} {
  const baseDate = timeZone ? toZonedTime(now, timeZone) : now;
  const today = format(baseDate, "yyyy-MM-dd");

  switch (preset) {
    case "today":
      return { startDate: today, endDate: today };
    case "7days": {
      const start = subDays(baseDate, 6);
      return { startDate: format(start, "yyyy-MM-dd"), endDate: today };
    }
    case "30days": {
      const start = subDays(baseDate, 29);
      return { startDate: format(start, "yyyy-MM-dd"), endDate: today };
    }
    case "thisMonth":
      return { startDate: format(baseDate, "yyyy-MM-01"), endDate: today };
  }
}
