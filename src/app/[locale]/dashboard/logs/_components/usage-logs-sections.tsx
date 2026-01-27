import { cache } from "react";
import { ActiveSessionsList } from "@/components/customs/active-sessions-list";
import { getEnvConfig } from "@/lib/config";
import { getSystemSettings } from "@/repository/system-config";
import { UsageLogsViewVirtualized } from "./usage-logs-view-virtualized";

const getCachedSystemSettings = cache(getSystemSettings);

interface UsageLogsDataSectionProps {
  isAdmin: boolean;
  userId: number;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function UsageLogsActiveSessionsSection() {
  const systemSettings = await getCachedSystemSettings();
  return (
    <ActiveSessionsList
      currencyCode={systemSettings.currencyDisplay}
      maxHeight="200px"
      showTokensCost={false}
    />
  );
}

export async function UsageLogsDataSection({
  isAdmin,
  userId,
  searchParams,
}: UsageLogsDataSectionProps) {
  const resolvedSearchParams = await searchParams;
  const { TZ } = getEnvConfig();

  return (
    <UsageLogsViewVirtualized
      isAdmin={isAdmin}
      userId={userId}
      searchParams={resolvedSearchParams}
      serverTimeZone={TZ}
    />
  );
}
