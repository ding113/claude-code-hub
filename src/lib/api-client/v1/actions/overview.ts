import type { OverviewData } from "@/actions/overview";
import { apiGet, toActionResult } from "./_compat";

export type { OverviewData } from "@/actions/overview";

export function getOverviewData() {
  return toActionResult(apiGet<OverviewData>("/api/v1/dashboard/overview"));
}
