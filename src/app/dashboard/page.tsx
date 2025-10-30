import { redirect } from "next/navigation";
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
import { getPrivacyContext } from "@/lib/utils/privacy-filter.server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // 检查价格表是否存在，如果不存在则跳转到价格上传页面
  const hasPrices = await hasPriceTable();
  if (!hasPrices) {
    redirect("/settings/prices?required=true");
  }

  const [users, session, statistics, systemSettings, privacyContext] = await Promise.all([
    getUsers(),
    getSession(),
    getUserStatistics(DEFAULT_TIME_RANGE),
    getSystemSettings(),
    getPrivacyContext(),
  ]);

  return (
    <div className="space-y-6">
      <OverviewPanel currencyCode={privacyContext.userCurrency} />

      <div>
        <StatisticsWrapper
          initialData={statistics.ok ? statistics.data : undefined}
          currencyCode={privacyContext.userCurrency}
        />
      </div>

      <Section title="客户端" description="用户和密钥管理">
        <ListErrorBoundary>
          <UserKeyManager
            users={users}
            currentUser={session?.user}
            currencyCode={privacyContext.userCurrency}
            canViewProviderInfo={privacyContext.isAdmin || privacyContext.allowViewProviderInfo}
          />
        </ListErrorBoundary>
      </Section>
    </div>
  );
}
