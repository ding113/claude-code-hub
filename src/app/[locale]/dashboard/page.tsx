import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { hasPriceTable } from "@/actions/model-prices";
import { getUserStatistics } from "@/actions/statistics";
import { OverviewPanel } from "@/components/customs/overview-panel";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { StatisticsWrapper } from "./_components/statistics";
import { TodayLeaderboard } from "./_components/today-leaderboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const t = await getTranslations("dashboard");

  // 检查价格表是否存在，如果不存在则跳转到价格上传页面
  const hasPrices = await hasPriceTable();
  if (!hasPrices) {
    return redirect({ href: "/settings/prices?required=true", locale });
  }

  const [session, statistics, systemSettings] = await Promise.all([
    getSession(),
    getUserStatistics(DEFAULT_TIME_RANGE),
    getSystemSettings(),
  ]);

  // 检查是否是 admin 用户
  const isAdmin = session?.user?.role === "admin";
  const canViewLeaderboard = isAdmin || systemSettings.allowGlobalUsageView;

  return (
    <div className="space-y-6">
      <OverviewPanel currencyCode={systemSettings.currencyDisplay} isAdmin={isAdmin} />

      <div>
        <StatisticsWrapper
          initialData={statistics.ok ? statistics.data : undefined}
          currencyCode={systemSettings.currencyDisplay}
        />
      </div>

      {canViewLeaderboard && (
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
      )}
    </div>
  );
}
