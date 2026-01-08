"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getMyQuota,
  getMyUsageLogs,
  type MyUsageLogsResult,
  type MyUsageQuota,
} from "@/actions/my-usage";
import { useRouter } from "@/i18n/routing";
import { CollapsibleQuotaCard } from "./_components/collapsible-quota-card";
import { ExpirationInfo } from "./_components/expiration-info";
import { MyUsageHeader } from "./_components/my-usage-header";
import { ProviderGroupInfo } from "./_components/provider-group-info";
import { StatisticsSummaryCard } from "./_components/statistics-summary-card";
import { UsageLogsSection } from "./_components/usage-logs-section";

export default function MyUsagePage() {
  const router = useRouter();

  const [quota, setQuota] = useState<MyUsageQuota | null>(null);
  const [logsData, setLogsData] = useState<MyUsageLogsResult | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(true);
  const [isLogsLoading, setIsLogsLoading] = useState(true);

  const loadInitial = useCallback(() => {
    setIsQuotaLoading(true);
    setIsLogsLoading(true);

    void getMyQuota()
      .then((quotaResult) => {
        if (quotaResult.ok) setQuota(quotaResult.data);
      })
      .finally(() => setIsQuotaLoading(false));

    void getMyUsageLogs({ page: 1 })
      .then((logsResult) => {
        if (logsResult.ok) setLogsData(logsResult.data ?? null);
      })
      .finally(() => setIsLogsLoading(false));
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const keyExpiresAt = quota?.expiresAt ?? null;
  const userExpiresAt = quota?.userExpiresAt ?? null;

  return (
    <div className="space-y-6">
      <MyUsageHeader
        onLogout={handleLogout}
        keyName={quota?.keyName}
        userName={quota?.userName}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      {/* Provider Group and Expiration info */}
      {quota ? (
        <div className="space-y-3">
          <ProviderGroupInfo
            keyProviderGroup={quota.keyProviderGroup}
            userProviderGroup={quota.userProviderGroup}
            userAllowedModels={quota.userAllowedModels}
            userAllowedClients={quota.userAllowedClients}
          />
          <ExpirationInfo
            keyExpiresAt={keyExpiresAt}
            userExpiresAt={userExpiresAt}
            userRpmLimit={quota.userRpmLimit}
          />
        </div>
      ) : null}

      <CollapsibleQuotaCard
        quota={quota}
        loading={isQuotaLoading}
        keyExpiresAt={keyExpiresAt}
        userExpiresAt={userExpiresAt}
      />

      <StatisticsSummaryCard />

      <UsageLogsSection initialData={logsData} loading={isLogsLoading} autoRefreshSeconds={30} />
    </div>
  );
}
