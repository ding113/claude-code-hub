import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { getUserStatistics } from "@/actions/statistics";
import { OverviewPanel } from "@/components/customs/overview-panel";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { getSystemSettings } from "@/repository/system-config";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { StatisticsWrapper } from "./statistics";
import { TodayLeaderboard } from "./today-leaderboard";

const getCachedSystemSettings = cache(getSystemSettings);

export async function DashboardOverviewSection({ isAdmin }: { isAdmin: boolean }) {
  const systemSettings = await getCachedSystemSettings();

  return <OverviewPanel currencyCode={systemSettings.currencyDisplay} isAdmin={isAdmin} />;
}

export async function DashboardStatisticsSection() {
  const [systemSettings, statistics] = await Promise.all([
    getCachedSystemSettings(),
    getUserStatistics(DEFAULT_TIME_RANGE),
  ]);

  return (
    <StatisticsWrapper
      initialData={statistics.ok ? statistics.data : undefined}
      currencyCode={systemSettings.currencyDisplay}
    />
  );
}

export async function DashboardLeaderboardSection({ isAdmin }: { isAdmin: boolean }) {
  const systemSettings = await getCachedSystemSettings();
  const canViewLeaderboard = isAdmin || systemSettings.allowGlobalUsageView;

  if (!canViewLeaderboard) {
    return null;
  }

  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("leaderboard.todayTitle")}</h2>
        <Link href="/dashboard/leaderboard">
          <Button variant="link" size="sm" className="px-0 sm:px-2">
            {t("leaderboard.viewAll")}
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>
      <TodayLeaderboard
        currencyCode={systemSettings.currencyDisplay}
        isAdmin={isAdmin}
        allowGlobalUsageView={systemSettings.allowGlobalUsageView}
      />
    </div>
  );
}
