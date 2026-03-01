"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getProviderManagerBootstrapData,
  getProviderStatisticsAsync,
  type ProviderManagerBootstrapData,
} from "@/actions/providers";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import { AddProviderDialog } from "./add-provider-dialog";
import { ProviderManager } from "./provider-manager";

interface ProviderManagerLoaderProps {
  currentUser?: User;
  enableMultiProviderTypes?: boolean;
}

function ProviderManagerLoaderContent({
  currentUser,
  enableMultiProviderTypes = true,
}: ProviderManagerLoaderProps) {
  const {
    data: bootstrap,
    isLoading: isBootstrapLoading,
    isFetching: isBootstrapFetching,
  } = useQuery<ProviderManagerBootstrapData>({
    queryKey: ["providers-bootstrap"],
    queryFn: getProviderManagerBootstrapData,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const providers: ProviderDisplay[] = bootstrap?.providers ?? [];
  const healthStatus = bootstrap?.healthStatus ?? {};
  const currencyCode = bootstrap?.systemSettings.currencyDisplay ?? "USD";

  // Statistics loaded independently with longer cache
  const { data: statistics = {} as ProviderStatisticsMap, isLoading: isStatisticsLoading } =
    useQuery<ProviderStatisticsMap>({
      queryKey: ["providers-statistics"],
      queryFn: getProviderStatisticsAsync,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      refetchInterval: 60_000,
    });

  const loading = isBootstrapLoading;
  const refreshing = !loading && isBootstrapFetching;

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
