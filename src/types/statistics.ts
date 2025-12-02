export type TimeRange = "today" | "7days" | "30days" | "thisMonth";

export interface TimeRangeConfig {
  label: string;
  key: TimeRange;
  resolution: "hour" | "day";
  description?: string;
}

// Note: Labels and descriptions are now managed through i18n translations
// See messages/*/dashboard.json under statistics.timeRange
export const TIME_RANGE_OPTIONS: TimeRangeConfig[] = [
  {
    label: "today", // Translation key
    key: "today",
    resolution: "hour",
    description: "todayDescription", // Translation key
  },
  {
    label: "7days", // Translation key
    key: "7days",
    resolution: "day",
    description: "7daysDescription", // Translation key
  },
  {
    label: "30days", // Translation key
    key: "30days",
    resolution: "day",
    description: "30daysDescription", // Translation key
  },
  {
    label: "thisMonth", // Translation key
    key: "thisMonth",
    resolution: "day",
    description: "thisMonthDescription", // Translation key
  },
];

export const DEFAULT_TIME_RANGE: TimeRange = "today";

export interface ChartDataItem {
  date: string;
  [key: string]: string | number;
}

export interface DatabaseStatRow {
  user_id: number;
  user_name: string;
  date: string;
  api_calls: number;
  total_cost: string | number | null;
}

export interface DatabaseUser {
  id: number;
  name: string;
}

export interface DatabaseKeyStatRow {
  key_id: number;
  key_name: string;
  date: string;
  api_calls: number;
  total_cost: string | number | null;
}

export interface DatabaseKey {
  id: number;
  name: string;
}

export interface StatisticsUser {
  id: number;
  name: string;
  dataKey: string;
}

export interface UserStatisticsData {
  chartData: ChartDataItem[];
  users: StatisticsUser[];
  timeRange: TimeRange;
  resolution: "hour" | "day";
  mode: "users" | "keys" | "mixed";
}

// Rate limit event statistics types
export type RateLimitType =
  | "rpm"
  | "usd_5h"
  | "usd_weekly"
  | "usd_monthly"
  | "usd_total"
  | "concurrent_sessions"
  | "daily_quota";

export interface EventTimeline {
  hour: string;
  count: number;
}

export interface RateLimitEventStats {
  total_events: number;
  events_by_type: Record<RateLimitType, number>;
  events_by_user: Record<number, number>;
  events_by_provider: Record<number, number>;
  events_timeline: EventTimeline[];
  avg_current_usage: number;
}

export interface RateLimitEventFilters {
  user_id?: number;
  provider_id?: number;
  limit_type?: RateLimitType;
  start_time?: Date;
  end_time?: Date;
  key_id?: number;
}
