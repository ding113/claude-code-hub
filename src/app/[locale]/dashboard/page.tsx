import { Suspense } from "react";
import { hasPriceTable } from "@/actions/model-prices";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import {
  DashboardLeaderboardSection,
  DashboardOverviewSection,
  DashboardStatisticsSection,
} from "./_components/dashboard-sections";
import {
  DashboardLeaderboardSkeleton,
  DashboardOverviewSkeleton,
  DashboardStatisticsSkeleton,
} from "./_components/dashboard-skeletons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  // 检查价格表是否存在，如果不存在则跳转到价格上传页面
  const hasPrices = await hasPriceTable();
  if (!hasPrices) {
    return redirect({ href: "/settings/prices?required=true", locale });
  }

  const session = await getSession();
  const isAdmin = session?.user?.role === "admin";

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Suspense fallback={<DashboardOverviewSkeleton />}>
          <DashboardOverviewSection isAdmin={isAdmin} />
        </Suspense>
      ) : null}

      <Suspense fallback={<DashboardStatisticsSkeleton />}>
        <DashboardStatisticsSection />
      </Suspense>

      <Suspense fallback={<DashboardLeaderboardSkeleton />}>
        <DashboardLeaderboardSection isAdmin={isAdmin} />
      </Suspense>
    </div>
  );
}
