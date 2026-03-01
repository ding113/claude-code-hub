import { cache } from "react";
import { getOverviewData } from "@/actions/overview";
import { getUserStatistics } from "@/actions/statistics";
import { getSystemSettings } from "@/repository/system-config";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { DashboardBento } from "./bento/dashboard-bento";

const getCachedSystemSettings = cache(getSystemSettings);

interface DashboardBentoSectionProps {
  isAdmin: boolean;
}

export async function DashboardBentoSection({ isAdmin }: DashboardBentoSectionProps) {
  const [systemSettings, statistics, overviewResult] = await Promise.all([
    getCachedSystemSettings(),
    getUserStatistics(DEFAULT_TIME_RANGE),
    getOverviewData(),
  ]);

  return (
    <DashboardBento
      isAdmin={isAdmin}
      currencyCode={systemSettings.currencyDisplay}
      allowGlobalUsageView={systemSettings.allowGlobalUsageView}
      initialStatistics={statistics.ok ? statistics.data : undefined}
      initialOverview={overviewResult.ok ? overviewResult.data : undefined}
    />
  );
}
