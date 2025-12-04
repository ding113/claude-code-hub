"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  getMyQuota,
  getMyTodayStats,
  getMyUsageLogs,
  type MyUsageLogsResult,
} from "@/actions/my-usage";
import { useRouter } from "@/i18n/routing";
import { MyUsageHeader } from "./_components/my-usage-header";
import { QuotaCards } from "./_components/quota-cards";
import { TodayUsageCard } from "./_components/today-usage-card";
import { UsageLogsSection } from "./_components/usage-logs-section";

export default function MyUsagePage() {
  const router = useRouter();

  const [quota, setQuota] = useState<Awaited<ReturnType<typeof getMyQuota>> | null>(null);
  const [todayStats, setTodayStats] = useState<Awaited<ReturnType<typeof getMyTodayStats>> | null>(
    null
  );
  const [logsData, setLogsData] = useState<MyUsageLogsResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadAll = useCallback(() => {
    startTransition(async () => {
      const [quotaResult, statsResult, logsResult] = await Promise.all([
        getMyQuota(),
        getMyTodayStats(),
        getMyUsageLogs({ page: 1 }),
      ]);

      if (quotaResult.ok) setQuota(quotaResult);
      if (statsResult.ok) setTodayStats(statsResult);
      if (logsResult.ok) setLogsData(logsResult.data ?? null);
    });
  }, []);

  const refreshToday = useCallback(async () => {
    const stats = await getMyTodayStats();
    if (stats.ok) setTodayStats(stats);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const id = setInterval(() => refreshToday(), 30000);
    return () => clearInterval(id);
  }, [refreshToday]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const quotaData = quota?.ok ? quota.data : null;
  const todayData = todayStats?.ok ? todayStats.data : null;

  return (
    <div className="space-y-6">
      <MyUsageHeader onLogout={handleLogout} />

      <QuotaCards
        quota={quotaData}
        loading={isPending}
        currencyCode={todayData?.currencyCode ?? "USD"}
      />

      <TodayUsageCard
        stats={todayData}
        loading={isPending}
        onRefresh={refreshToday}
        autoRefreshSeconds={30}
      />

      <UsageLogsSection initialData={logsData} />
    </div>
  );
}
