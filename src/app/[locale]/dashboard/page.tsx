import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getUserStatistics } from "@/actions/statistics";
import { hasPriceTable } from "@/actions/model-prices";
import { getSystemSettings } from "@/repository/system-config";
import { StatisticsWrapper } from "./_components/statistics";
import { OverviewPanel } from "@/components/customs/overview-panel";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { getTranslations } from "next-intl/server";

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

  return (
    <div className="space-y-6">
      <OverviewPanel currencyCode={systemSettings.currencyDisplay} isAdmin={isAdmin} />

      <div>
        <StatisticsWrapper
          initialData={statistics.ok ? statistics.data : undefined}
          currencyCode={systemSettings.currencyDisplay}
        />
      </div>

      {/* UserKeyManager removed - functionality moved to /dashboard/users */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">{t("overview")}</h2>
        {/* Statistics and overview cards are now the primary dashboard content */}
      </div>
    </div>
  );
}
