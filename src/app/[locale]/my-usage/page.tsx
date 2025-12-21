"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMyQuota,
  getMyTodayStats,
  getMyUsageLogs,
  type MyTodayStats,
  type MyUsageLogsResult,
  type MyUsageQuota,
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

  const [quota, setQuota] = useState<MyUsageQuota | null>(null);
  const [todayStats, setTodayStats] = useState<MyTodayStats | null>(null);
  const [logsData, setLogsData] = useState<MyUsageLogsResult | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(true);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [isLogsLoading, setIsLogsLoading] = useState(true);
  const [isStatsRefreshing, setIsStatsRefreshing] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadInitial = useCallback(() => {
    setIsQuotaLoading(true);
    setIsStatsLoading(true);
    setIsLogsLoading(true);

    void getMyQuota()
      .then((quotaResult) => {
        if (quotaResult.ok) setQuota(quotaResult.data);
      })
      .finally(() => setIsQuotaLoading(false));

    void getMyTodayStats()
      .then((statsResult) => {
        if (statsResult.ok) setTodayStats(statsResult.data);
      })
      .finally(() => setIsStatsLoading(false));

    void getMyUsageLogs({ page: 1 })
      .then((logsResult) => {
        if (logsResult.ok) setLogsData(logsResult.data ?? null);
      })
      .finally(() => setIsLogsLoading(false));
  }, []);

  const refreshToday = useCallback(async () => {
    setIsStatsRefreshing(true);
    const stats = await getMyTodayStats();
    if (stats.ok) setTodayStats(stats.data);
    setIsStatsRefreshing(false);
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const POLL_INTERVAL = 30000;

    const startPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(() => {
        refreshToday();
        // Note: logs polling is handled internally by UsageLogsSection
        // to preserve pagination state
      }, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        refreshToday();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshToday]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const keyExpiresAt = quota?.expiresAt ?? null;
  const userExpiresAt = quota?.userExpiresAt ?? null;
  const currencyCode = todayStats?.currencyCode ?? "USD";

  return (
    <div className="space-y-6">
      <MyUsageHeader
        onLogout={handleLogout}
        keyName={quota?.keyName}
        userName={quota?.userName}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      <QuotaCards
        quota={quota}
        loading={isQuotaLoading}
        currencyCode={currencyCode}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      {quota ? (
        <div className="space-y-3">
          <ExpirationInfo keyExpiresAt={keyExpiresAt} userExpiresAt={userExpiresAt} />
          <ProviderGroupInfo
            keyProviderGroup={quota.keyProviderGroup}
            userProviderGroup={quota.userProviderGroup}
          />
        </div>
      ) : null}

      <TodayUsageCard
        stats={todayStats}
        loading={isStatsLoading}
        refreshing={isStatsRefreshing}
        onRefresh={refreshToday}
        autoRefreshSeconds={30}
      />

      <UsageLogsSection initialData={logsData} loading={isLogsLoading} autoRefreshSeconds={30} />
    </div>
  );
}
