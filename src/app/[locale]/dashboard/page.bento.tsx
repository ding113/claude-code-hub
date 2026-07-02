import { Suspense } from "react";
import { hasPriceTable } from "@/actions/model-prices";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { DashboardBentoSection } from "./_components/dashboard-bento-sections";
import { DashboardOverviewSkeleton } from "./_components/dashboard-skeletons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, hasPrices, session] = await Promise.all([
    params,
    hasPriceTable(),
    getSession(),
  ]);
  if (!hasPrices) {
    return redirect({ href: "/settings/prices?required=true", locale });
  }

  const isAdmin = session?.user?.role === "admin";

  return (
    <Suspense fallback={<DashboardOverviewSkeleton />}>
      <DashboardBentoSection isAdmin={isAdmin} />
    </Suspense>
  );
}
