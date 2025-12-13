"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();
  const [hasLoaded, setHasLoaded] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadInitial = useCallback(() => {
    startTransition(async () => {
      const [quotaResult, statsResult, logsResult] = await Promise.all([
        getMyQuota(),
        getMyTodayStats(),
        getMyUsageLogs({ page: 1 }),
      ]);

      if (quotaResult.ok) setQuota(quotaResult.data);
      if (statsResult.ok) setTodayStats(statsResult.data);
      if (logsResult.ok) setLogsData(logsResult.data ?? null);
      setHasLoaded(true);
    });
  }, []);

  const refreshToday = useCallback(async () => {
    const stats = await getMyTodayStats();
    if (stats.ok) setTodayStats(stats.data);
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
        keyProviderGroup={quota?.keyProviderGroup ?? null}
        userProviderGroup={quota?.userProviderGroup ?? null}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      <QuotaCards
        quota={quota}
        loading={!hasLoaded || isPending}
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
        loading={!hasLoaded || isPending}
        onRefresh={refreshToday}
        autoRefreshSeconds={30}
      />

      <UsageLogsSection initialData={logsData} autoRefreshSeconds={30} />
    </div>
  );
}
