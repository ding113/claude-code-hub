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
} {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;

  switch (preset) {
    case "today":
      return { startDate: today, endDate: today };
    case "7days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      const sy = start.getFullYear();
      const sm = String(start.getMonth() + 1).padStart(2, "0");
      const sd = String(start.getDate()).padStart(2, "0");
      return { startDate: `${sy}-${sm}-${sd}`, endDate: today };
    }
    case "30days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      const sy = start.getFullYear();
      const sm = String(start.getMonth() + 1).padStart(2, "0");
      const sd = String(start.getDate()).padStart(2, "0");
      return { startDate: `${sy}-${sm}-${sd}`, endDate: today };
    }
    case "thisMonth":
      return { startDate: `${yyyy}-${mm}-01`, endDate: today };
  }
}
