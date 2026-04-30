"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/i18n/routing";
import { meClient } from "@/lib/api-client/v1/me";
import { systemClient } from "@/lib/api-client/v1/system";
import type { MyUsageQuota } from "@/types/my-usage";
import { CollapsibleQuotaCard } from "./_components/collapsible-quota-card";
import { ExpirationInfo } from "./_components/expiration-info";
import { MyUsageHeader } from "./_components/my-usage-header";
import { ProviderGroupInfo } from "./_components/provider-group-info";
import { StatisticsSummaryCard } from "./_components/statistics-summary-card";
import { UsageLogsSection } from "./_components/usage-logs-section";

export default function MyUsagePage() {
  const router = useRouter();

  const [quota, setQuota] = useState<MyUsageQuota | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(true);
  const [serverTimeZone, setServerTimeZone] = useState<string | undefined>(undefined);

  const loadInitial = useCallback(() => {
    setIsQuotaLoading(true);

    void meClient
      .quota()
      .then((data) => setQuota(data as unknown as MyUsageQuota))
      .catch(() => undefined)
      .finally(() => setIsQuotaLoading(false));

    void systemClient
      .getTimezone()
      .then((data) => setServerTimeZone(data.timeZone))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const toDate = (value: Date | string | null | undefined): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const keyExpiresAt = toDate(quota?.expiresAt ?? null);
  const userExpiresAt = toDate(quota?.userExpiresAt ?? null);

  return (
    <div className="space-y-6">
      <MyUsageHeader onLogout={handleLogout} keyName={quota?.keyName} userName={quota?.userName} />

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
            timezone={serverTimeZone}
          />
        </div>
      ) : null}

      <CollapsibleQuotaCard quota={quota} loading={isQuotaLoading} />

      <StatisticsSummaryCard serverTimeZone={serverTimeZone} />

      <UsageLogsSection autoRefreshSeconds={30} serverTimeZone={serverTimeZone} />
    </div>
  );
}
