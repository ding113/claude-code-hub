"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getKeys } from "@/actions/keys";
import { getProviders } from "@/actions/providers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";
import type { BillingModelSource, SystemSettings } from "@/types/system-config";
import { UsageLogsFilters } from "./usage-logs-filters";
import { UsageLogsStatsPanel } from "./usage-logs-stats-panel";
import { VirtualizedLogsTable, type VirtualizedLogsTableFilters } from "./virtualized-logs-table";

// Create a stable QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

interface UsageLogsViewVirtualizedProps {
  isAdmin: boolean;
  userId: number;
  providers?: ProviderDisplay[];
  initialKeys?: Key[];
  searchParams: { [key: string]: string | string[] | undefined };
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
}

async function fetchSystemSettings(): Promise<SystemSettings> {
  const response = await fetch("/api/system-settings");
  if (!response.ok) {
    throw new Error("FETCH_SETTINGS_FAILED");
  }
  return response.json() as Promise<SystemSettings>;
}

function UsageLogsViewContent({
  isAdmin,
  userId,
  providers,
  initialKeys,
  searchParams,
  currencyCode = "USD",
  billingModelSource = "original",
}: UsageLogsViewVirtualizedProps) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const _params = useSearchParams();
  const queryClientInstance = useQueryClient();
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsKey = _params.toString();

  const shouldFetchSettings = !currencyCode || !billingModelSource;
  const { data: systemSettings } = useQuery<SystemSettings>({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    enabled: shouldFetchSettings,
  });

  const resolvedCurrencyCode = currencyCode ?? systemSettings?.currencyDisplay ?? "USD";
  const resolvedBillingModelSource =
    billingModelSource ?? systemSettings?.billingModelSource ?? "original";

  const { data: providersData = [], isLoading: isProvidersLoading } = useQuery<ProviderDisplay[]>({
    queryKey: ["usage-log-providers"],
    queryFn: getProviders,
    enabled: isAdmin && providers === undefined,
    placeholderData: [],
  });

  const { data: keysResult, isLoading: isKeysLoading } = useQuery({
    queryKey: ["usage-log-keys", userId],
    queryFn: () => getKeys(userId),
    enabled: !isAdmin && initialKeys === undefined,
  });

  const resolvedProviders = providers ?? providersData;
  const resolvedKeys = initialKeys ?? (keysResult?.ok && keysResult.data ? keysResult.data : []);

  // Parse filters from URL with stable reference
  const filters = useMemo<VirtualizedLogsTableFilters & { page?: number }>(
    () => ({
      userId: searchParams.userId ? parseInt(searchParams.userId as string, 10) : undefined,
      keyId: searchParams.keyId ? parseInt(searchParams.keyId as string, 10) : undefined,
      providerId: searchParams.providerId
        ? parseInt(searchParams.providerId as string, 10)
        : undefined,
      startTime: searchParams.startTime
        ? parseInt(searchParams.startTime as string, 10)
        : undefined,
      endTime: searchParams.endTime ? parseInt(searchParams.endTime as string, 10) : undefined,
      statusCode:
        searchParams.statusCode && searchParams.statusCode !== "!200"
          ? parseInt(searchParams.statusCode as string, 10)
          : undefined,
      excludeStatusCode200: searchParams.statusCode === "!200",
      model: searchParams.model as string | undefined,
      endpoint: searchParams.endpoint as string | undefined,
      minRetryCount: searchParams.minRetry
        ? parseInt(searchParams.minRetry as string, 10)
        : undefined,
    }),
    [
      searchParams.userId,
      searchParams.keyId,
      searchParams.providerId,
      searchParams.startTime,
      searchParams.endTime,
      searchParams.statusCode,
      searchParams.model,
      searchParams.endpoint,
      searchParams.minRetry,
    ]
  );

  // Manual refresh handler
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    await queryClientInstance.invalidateQueries({ queryKey: ["usage-logs-batch"] });
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => setIsManualRefreshing(false), 500);
  }, [queryClientInstance]);

  // Handle filter changes
  const handleFilterChange = (newFilters: Omit<typeof filters, "page">) => {
    const query = new URLSearchParams();

    if (newFilters.userId) query.set("userId", newFilters.userId.toString());
    if (newFilters.keyId) query.set("keyId", newFilters.keyId.toString());
    if (newFilters.providerId) query.set("providerId", newFilters.providerId.toString());
    if (newFilters.startTime) query.set("startTime", newFilters.startTime.toString());
    if (newFilters.endTime) query.set("endTime", newFilters.endTime.toString());
    if (newFilters.excludeStatusCode200) {
      query.set("statusCode", "!200");
    } else if (newFilters.statusCode !== undefined) {
      query.set("statusCode", newFilters.statusCode.toString());
    }
    if (newFilters.model) query.set("model", newFilters.model);
    if (newFilters.endpoint) query.set("endpoint", newFilters.endpoint);
    if (newFilters.minRetryCount !== undefined) {
      query.set("minRetry", newFilters.minRetryCount.toString());
    }

    router.push(`/dashboard/logs?${query.toString()}`);
  };

  // Invalidate query when URL changes (e.g., browser back/forward navigation)
  useEffect(() => {
    void paramsKey;
    queryClientInstance.invalidateQueries({ queryKey: ["usage-logs-batch"] });
  }, [paramsKey, queryClientInstance]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Collapsible stats panel */}
      <UsageLogsStatsPanel
        filters={{
          userId: filters.userId,
          keyId: filters.keyId,
          providerId: filters.providerId,
          startTime: filters.startTime,
          endTime: filters.endTime,
          statusCode: filters.statusCode,
          excludeStatusCode200: filters.excludeStatusCode200,
          model: filters.model,
          endpoint: filters.endpoint,
          minRetryCount: filters.minRetryCount,
        }}
        currencyCode={resolvedCurrencyCode}
      />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t("title.filterCriteria")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageLogsFilters
            isAdmin={isAdmin}
            providers={resolvedProviders}
            initialKeys={resolvedKeys}
            filters={filters}
            onChange={handleFilterChange}
            onReset={() => router.push("/dashboard/logs")}
            isProvidersLoading={isProvidersLoading}
            isKeysLoading={isKeysLoading}
          />
        </CardContent>
      </Card>

      {/* Data table with virtual scrolling */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("title.usageLogs")}</CardTitle>
            <div className="flex items-center gap-2">
              {/* Manual refresh button */}
              <Button variant="outline" size="sm" onClick={handleManualRefresh} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`} />
                {t("logs.actions.refresh")}
              </Button>

              {/* Auto refresh toggle */}
              <Button
                variant={isAutoRefresh ? "default" : "outline"}
                size="sm"
                onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                className="gap-2"
              >
                {isAutoRefresh ? (
                  <>
                    <Pause className="h-4 w-4" />
                    {t("logs.actions.stopAutoRefresh")}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {t("logs.actions.startAutoRefresh")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <VirtualizedLogsTable
            filters={filters}
            currencyCode={resolvedCurrencyCode}
            billingModelSource={resolvedBillingModelSource}
            autoRefreshEnabled={isAutoRefresh}
            autoRefreshIntervalMs={5000}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function UsageLogsViewVirtualized(props: UsageLogsViewVirtualizedProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <UsageLogsViewContent {...props} />
    </QueryClientProvider>
  );
}
