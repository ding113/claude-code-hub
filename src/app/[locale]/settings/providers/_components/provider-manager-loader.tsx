"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getProviderStatisticsAsync,
  getProviders,
  getProvidersHealthStatus,
} from "@/actions/providers";
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
  const {
    data: providers = [],
    isLoading: isProvidersLoading,
    isFetching: isProvidersFetching,
  } = useQuery<ProviderDisplay[]>({
    queryKey: ["providers"],
    queryFn: getProviders,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const {
    data: healthStatus = {} as ProviderHealthStatus,
    isLoading: isHealthLoading,
    isFetching: isHealthFetching,
  } = useQuery<ProviderHealthStatus>({
    queryKey: ["providers-health"],
    queryFn: getProvidersHealthStatus,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // Statistics loaded independently with longer cache
  const { data: statistics = {} as ProviderStatisticsMap, isLoading: isStatisticsLoading } =
    useQuery<ProviderStatisticsMap>({
      queryKey: ["providers-statistics"],
      queryFn: getProviderStatisticsAsync,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      refetchInterval: 60_000,
    });

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
