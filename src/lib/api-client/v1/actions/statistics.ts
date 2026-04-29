import type { TimeRange, UserStatisticsData } from "@/types/statistics";
import { apiGet, searchParams, toActionResult } from "./_compat";

export function getUserStatistics(timeRange?: TimeRange) {
  return toActionResult(
    apiGet<UserStatisticsData>(`/api/v1/dashboard/statistics${searchParams({ timeRange })}`)
  );
}
