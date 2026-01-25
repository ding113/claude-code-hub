import { cache } from "react";
import { ActiveSessionsCards } from "@/components/customs/active-sessions-cards";
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
  return <ActiveSessionsCards currencyCode={systemSettings.currencyDisplay} />;
}

export async function UsageLogsDataSection({
  isAdmin,
  userId,
  searchParams,
}: UsageLogsDataSectionProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <UsageLogsViewVirtualized
      isAdmin={isAdmin}
      userId={userId}
      searchParams={resolvedSearchParams}
    />
  );
}
