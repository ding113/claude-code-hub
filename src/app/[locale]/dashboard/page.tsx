import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { Section } from "@/components/section";
import { UserKeyManager } from "./_components/user/user-key-manager";
import { getUsers } from "@/actions/users";
import { getUserStatistics } from "@/actions/statistics";
import { hasPriceTable } from "@/actions/model-prices";
import { getSystemSettings } from "@/repository/system-config";
import { ListErrorBoundary } from "@/components/error-boundary";
import { StatisticsWrapper } from "./_components/statistics";
import { OverviewPanel } from "@/components/customs/overview-panel";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Await params to ensure locale is available in the async context
  await params;

  const t = await getTranslations("dashboard");

  // 检查价格表是否存在，如果不存在则跳转到价格上传页面
  const hasPrices = await hasPriceTable();
  if (!hasPrices) {
    redirect("/settings/prices?required=true" as any);
  }

  const [users, session, statistics, systemSettings] = await Promise.all([
    getUsers(),
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

      <Section title={t("title.clients")} description={t("title.userAndKeyManagement")}>
        <ListErrorBoundary>
          <UserKeyManager
            users={users}
            currentUser={session?.user}
            currencyCode={systemSettings.currencyDisplay}
          />
        </ListErrorBoundary>
      </Section>
    </div>
  );
}
