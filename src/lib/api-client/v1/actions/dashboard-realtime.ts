import type { DashboardRealtimeData } from "@/actions/dashboard-realtime";
import { apiGet, toActionResult } from "./_compat";

export type { DashboardRealtimeData } from "@/actions/dashboard-realtime";

export function getDashboardRealtimeData() {
  return toActionResult(apiGet<DashboardRealtimeData>("/api/v1/dashboard/realtime"));
}
