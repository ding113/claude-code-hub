"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getProviderStatisticsAsync,
  getProviders,
  getProvidersHealthStatus,
} from "@/lib/api-client/v1/actions/providers";
import { getSystemSettings } from "@/lib/api-client/v1/actions/system-config";
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
    queryFn: getSystemSettings,
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
