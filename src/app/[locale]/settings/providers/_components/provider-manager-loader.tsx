"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getProviders, getProvidersHealthStatus } from "@/actions/providers";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

async function fetchSystemSettings(): Promise<{ currencyDisplay: CurrencyCode }> {
  const response = await fetch("/api/system-settings");
  if (!response.ok) {
    throw new Error("FETCH_SETTINGS_FAILED");
  }
  return response.json() as Promise<{ currencyDisplay: CurrencyCode }>;
}

interface ProviderManagerLoaderProps {
  currentUser?: User;
  enableMultiProviderTypes: boolean;
  addDialogSlot?: ReactNode;
}

function ProviderManagerLoaderContent({
  currentUser,
  enableMultiProviderTypes,
  addDialogSlot,
}: ProviderManagerLoaderProps) {
  const {
    data: providers = [],
    isLoading: isProvidersLoading,
    isFetching: isProvidersFetching,
  } = useQuery<ProviderDisplay[]>({
    queryKey: ["providers"],
    queryFn: getProviders,
  });

  const {
    data: healthStatus = {} as ProviderHealthStatus,
    isLoading: isHealthLoading,
    isFetching: isHealthFetching,
  } = useQuery<ProviderHealthStatus>({
    queryKey: ["providers-health"],
    queryFn: getProvidersHealthStatus,
  });

  const {
    data: systemSettings,
    isLoading: isSettingsLoading,
    isFetching: isSettingsFetching,
  } = useQuery<{ currencyDisplay: CurrencyCode }>({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
  });

  const loading = isProvidersLoading || isHealthLoading || isSettingsLoading;
  const refreshing = !loading && (isProvidersFetching || isHealthFetching || isSettingsFetching);
  const currencyCode = systemSettings?.currencyDisplay ?? "USD";

  return (
    <ProviderManager
      providers={providers}
      currentUser={currentUser}
      healthStatus={healthStatus}
      currencyCode={currencyCode}
      enableMultiProviderTypes={enableMultiProviderTypes}
      loading={loading}
      refreshing={refreshing}
      addDialogSlot={addDialogSlot}
    />
  );
}

export function ProviderManagerLoader(props: ProviderManagerLoaderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProviderManagerLoaderContent {...props} />
    </QueryClientProvider>
  );
}
