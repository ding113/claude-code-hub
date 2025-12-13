"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  getMyTodayStats,
  getMyUsageLogs,
  getMyUsageMetadata,
  type MyTodayStats,
  type MyUsageLogsResult,
  type MyUsageMetadata,
} from "@/actions/my-usage";
import { useRouter } from "@/i18n/routing";
import { ExpirationInfo } from "./_components/expiration-info";
import { MyUsageHeader } from "./_components/my-usage-header";
import { ProviderGroupInfo } from "./_components/provider-group-info";
import { QuotaDialog } from "./_components/quota-dialog";
import { TodayUsageCard } from "./_components/today-usage-card";
import { UsageLogsSection } from "./_components/usage-logs-section";

export default function MyUsagePage() {
  const router = useRouter();

  const [metadata, setMetadata] = useState<MyUsageMetadata | null>(null);
  const [todayStats, setTodayStats] = useState<MyTodayStats | null>(null);
  const [logsData, setLogsData] = useState<MyUsageLogsResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hasLoaded, setHasLoaded] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadInitial = useCallback(() => {
    startTransition(async () => {
      const [metaResult, statsResult, logsResult] = await Promise.all([
        getMyUsageMetadata(),
        getMyTodayStats(),
        getMyUsageLogs({ page: 1 }),
      ]);

      if (metaResult.ok) setMetadata(metaResult.data);
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

  const keyExpiresAt = metadata?.keyExpiresAt ?? null;
  const userExpiresAt = metadata?.userExpiresAt ?? null;
  const currencyCode = todayStats?.currencyCode ?? metadata?.currencyCode ?? "USD";

  return (
    <div className="space-y-6">
      <MyUsageHeader
        onLogout={handleLogout}
        keyName={metadata?.keyName}
        userName={metadata?.userName}
        keyProviderGroup={metadata?.keyProviderGroup ?? null}
        userProviderGroup={metadata?.userProviderGroup ?? null}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
        quotaButton={
          <QuotaDialog
            currencyCode={currencyCode}
            keyExpiresAt={keyExpiresAt}
            userExpiresAt={userExpiresAt}
          />
        }
      />

      {metadata ? (
        <div className="space-y-3">
          <ExpirationInfo keyExpiresAt={keyExpiresAt} userExpiresAt={userExpiresAt} />
          <ProviderGroupInfo
            keyProviderGroup={metadata.keyProviderGroup}
            userProviderGroup={metadata.userProviderGroup}
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
