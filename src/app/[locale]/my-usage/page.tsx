"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  getMyQuota,
  getMyTodayStats,
  getMyUsageLogs,
  type MyUsageLogsResult,
} from "@/actions/my-usage";
import { useRouter } from "@/i18n/routing";
import { ExpirationInfo } from "./_components/expiration-info";
import { MyUsageHeader } from "./_components/my-usage-header";
import { ProviderGroupInfo } from "./_components/provider-group-info";
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
  const [hasLoaded, setHasLoaded] = useState(false);

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
      setHasLoaded(true);
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
  const keyExpiresAt = quotaData?.expiresAt ?? null;
  const userExpiresAt = quotaData?.userExpiresAt ?? null;

  return (
    <div className="space-y-6">
      <MyUsageHeader
        onLogout={handleLogout}
        keyName={quotaData?.keyName}
        userName={quotaData?.userName}
        keyProviderGroup={quotaData?.keyProviderGroup ?? null}
        userProviderGroup={quotaData?.userProviderGroup ?? null}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      {quotaData ? (
        <div className="space-y-3">
          <ExpirationInfo keyExpiresAt={keyExpiresAt} userExpiresAt={userExpiresAt} />
          <ProviderGroupInfo
            keyProviderGroup={quotaData.keyProviderGroup}
            userProviderGroup={quotaData.userProviderGroup}
          />
        </div>
      ) : null}

      <QuotaCards
        quota={quotaData}
        loading={!hasLoaded || isPending}
        currencyCode={todayData?.currencyCode ?? "USD"}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      <TodayUsageCard
        stats={todayData}
        loading={!hasLoaded || isPending}
        onRefresh={refreshToday}
        autoRefreshSeconds={30}
      />

      <UsageLogsSection initialData={logsData} />
    </div>
  );
}
