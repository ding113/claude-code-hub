"use client";

import { useQuery } from "@tanstack/react-query";
import { useProvidersHealth, useProvidersList } from "@/lib/api-client/v1/providers/hooks";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import { AddProviderDialog } from "./add-provider-dialog";
import { ProviderManager } from "./provider-manager";

type ProviderHealthStatus = Record<
  number,
  {
    circuitState: "closed" | "open" | "half-open";
    failureCount: number;
    lastFailureTime: number | null;
    circuitOpenUntil: number | null;
    recoveryMinutes: number | null;
  }
>;

async function fetchSystemSettings(): Promise<{ currencyDisplay: CurrencyCode }> {
  const response = await fetch("/api/system-settings");
  if (!response.ok) {
    throw new Error("FETCH_SETTINGS_FAILED");
  }
  return response.json() as Promise<{ currencyDisplay: CurrencyCode }>;
}

interface ProviderManagerLoaderProps {
  currentUser?: User;
  enableMultiProviderTypes?: boolean;
}

function ProviderManagerLoaderContent({
  currentUser,
  enableMultiProviderTypes = true,
}: ProviderManagerLoaderProps) {
  // Use v1 hooks; merge providers + statistics into the legacy ProviderDisplay shape.
  const {
    data: providersResponse,
    isLoading: isProvidersLoading,
    isFetching: isProvidersFetching,
  } = useProvidersList({ include: "statistics" });

  const providers = (providersResponse?.items ?? []) as unknown as ProviderDisplay[];
  const statistics = (providersResponse?.statistics ?? {}) as ProviderStatisticsMap;
  const isStatisticsLoading = isProvidersLoading;

  const {
    data: healthStatus = {} as ProviderHealthStatus,
    isLoading: isHealthLoading,
    isFetching: isHealthFetching,
  } = useProvidersHealth() as unknown as {
    data: ProviderHealthStatus;
    isLoading: boolean;
    isFetching: boolean;
  };

  const {
    data: systemSettings,
    isLoading: isSettingsLoading,
    isFetching: isSettingsFetching,
  } = useQuery<{ currencyDisplay: CurrencyCode }>({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const loading = isProvidersLoading || isHealthLoading || isSettingsLoading;
  const refreshing = !loading && (isProvidersFetching || isHealthFetching || isSettingsFetching);
  const currencyCode = systemSettings?.currencyDisplay ?? "USD";

  return (
    <ProviderManager
      providers={providers}
      currentUser={currentUser}
      healthStatus={healthStatus}
      statistics={statistics}
      statisticsLoading={isStatisticsLoading}
      currencyCode={currencyCode}
      enableMultiProviderTypes={enableMultiProviderTypes}
      loading={loading}
      refreshing={refreshing}
      addDialogSlot={<AddProviderDialog enableMultiProviderTypes={enableMultiProviderTypes} />}
    />
  );
}

export function ProviderManagerLoader(props: ProviderManagerLoaderProps) {
  return <ProviderManagerLoaderContent {...props} />;
}
