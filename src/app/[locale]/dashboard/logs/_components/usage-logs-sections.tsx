import { cache } from "react";
import { ActiveSessionsList } from "@/components/customs/active-sessions-list";
import { getEnvConfig } from "@/lib/config/env.schema";
import type { CurrencyCode } from "@/lib/utils";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { getSystemSettings } from "@/repository/system-config";
import type { SystemSettings } from "@/types/system-config";
import { UsageLogsViewVirtualized } from "./usage-logs-view-virtualized";

const getCachedSystemSettings = cache(getSystemSettings);

interface UsageLogsDataSectionProps {
  isAdmin: boolean;
  userId: number;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  systemSettings?: Pick<SystemSettings, "billingModelSource" | "currencyDisplay">;
}

export function UsageLogsActiveSessionsSection({ currencyCode }: { currencyCode: CurrencyCode }) {
  return (
    <ActiveSessionsList currencyCode={currencyCode} maxHeight="200px" showTokensCost={false} />
  );
}

export async function UsageLogsDataSection({
  isAdmin,
  userId,
  searchParams,
  systemSettings: systemSettingsProp,
}: UsageLogsDataSectionProps) {
  const resolvedSearchParams = await searchParams;
  const serverTimeZone = await resolveSystemTimezone();
  const systemSettings = systemSettingsProp ?? (await getCachedSystemSettings());

  return (
    <UsageLogsViewVirtualized
      isAdmin={isAdmin}
      userId={userId}
      searchParams={resolvedSearchParams}
      serverTimeZone={serverTimeZone}
      billingModelSource={systemSettings.billingModelSource}
      currencyCode={systemSettings.currencyDisplay}
      logsRefreshIntervalMs={getEnvConfig().DASHBOARD_LOGS_POLL_INTERVAL_MS}
    />
  );
}
