import { getTranslations } from "next-intl/server";
import { hasPriceTable } from "@/actions/model-prices";
import { getUserStatistics } from "@/actions/statistics";
import { getUsers } from "@/actions/users";
import { OverviewPanel } from "@/components/customs/overview-panel";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { StatisticsWrapper } from "./_components/statistics";
import { UserQuickOverview } from "./_components/user-quick-overview";

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

  const [session, statistics, systemSettings, users] = await Promise.all([
    getSession(),
    getUserStatistics(DEFAULT_TIME_RANGE),
    getSystemSettings(),
    getUsers(),
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

      {/* User Quick Overview Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t("overview.title")}</h2>
        </div>
        <UserQuickOverview users={users} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
