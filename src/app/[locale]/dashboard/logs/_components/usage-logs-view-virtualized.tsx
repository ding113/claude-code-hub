"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Expand, Filter, ListOrdered, Minimize2, Pause, Play, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getKeys } from "@/actions/keys";
import type { OverviewData } from "@/actions/overview";
import { getOverviewData } from "@/actions/overview";
import { getProviders } from "@/actions/providers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { getHiddenColumns, type LogsTableColumn } from "@/lib/column-visibility";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";
import type { BillingModelSource, SystemSettings } from "@/types/system-config";
import { buildLogsUrlQuery, parseLogsUrlFilters } from "../_utils/logs-query";
import { ColumnVisibilityDropdown } from "./column-visibility-dropdown";
import { UsageLogsFilters } from "./usage-logs-filters";
import { UsageLogsStatsPanel } from "./usage-logs-stats-panel";
import { VirtualizedLogsTable, type VirtualizedLogsTableFilters } from "./virtualized-logs-table";

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

async function fetchOverviewData(): Promise<OverviewData> {
  const result = await getOverviewData();
  if (!result.ok) {
    throw new Error(result.error || "FETCH_OVERVIEW_FAILED");
  }
  return result.data;
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
  const tc = useTranslations("customs");
  const locale = useLocale();
  const router = useRouter();
  const _params = useSearchParams();
  const queryClientInstance = useQueryClient();
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsKey = _params.toString();

  const fullscreen = useFullscreen();
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [hideProviderColumn, setHideProviderColumn] = useState(false);
  const wasInFullscreenRef = useRef(false);
  const [hiddenColumns, setHiddenColumns] = useState<LogsTableColumn[]>([]);

  // Load initial hidden columns from localStorage
  useEffect(() => {
    const stored = getHiddenColumns(userId, "usage-logs");
    setHiddenColumns(stored);
  }, [userId]);

  const resetFullscreenState = useCallback(() => {
    setIsFullscreenOpen(false);
    setHideProviderColumn(false);
    wasInFullscreenRef.current = false;
  }, []);

  const msFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "millisecond",
        unitDisplay: "narrow",
        maximumFractionDigits: 0,
      }),
    [locale]
  );

  const secFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "second",
        unitDisplay: "narrow",
        maximumFractionDigits: 1,
      }),
    [locale]
  );

  const formatResponseTime = useCallback(
    (ms: number) => {
      if (ms < 1000) return msFormatter.format(ms);
      return secFormatter.format(ms / 1000);
    },
    [msFormatter, secFormatter]
  );

  const shouldFetchSettings = !currencyCode || !billingModelSource;
  const { data: systemSettings } = useQuery<SystemSettings>({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    enabled: shouldFetchSettings || isFullscreenOpen,
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

  const filters = useMemo<VirtualizedLogsTableFilters & { page?: number }>(() => {
    return parseLogsUrlFilters({
      userId: searchParams.userId,
      keyId: searchParams.keyId,
      providerId: searchParams.providerId,
      sessionId: searchParams.sessionId,
      startTime: searchParams.startTime,
      endTime: searchParams.endTime,
      statusCode: searchParams.statusCode,
      model: searchParams.model,
      endpoint: searchParams.endpoint,
      minRetry: searchParams.minRetry,
      page: searchParams.page,
    }) as VirtualizedLogsTableFilters & { page?: number };
  }, [
    searchParams.userId,
    searchParams.keyId,
    searchParams.providerId,
    searchParams.sessionId,
    searchParams.startTime,
    searchParams.endTime,
    searchParams.statusCode,
    searchParams.model,
    searchParams.endpoint,
    searchParams.minRetry,
    searchParams.page,
  ]);

  const { data: overviewData } = useQuery<OverviewData>({
    queryKey: ["overview-data"],
    queryFn: fetchOverviewData,
    enabled: isFullscreenOpen,
    refetchInterval: isFullscreenOpen ? 3000 : false,
    refetchOnWindowFocus: false,
  });

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    await queryClientInstance.invalidateQueries({ queryKey: ["usage-logs-batch"] });
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => setIsManualRefreshing(false), 500);
  }, [queryClientInstance]);

  const handleEnterFullscreen = useCallback(async () => {
    if (!fullscreen.supported) return;

    wasInFullscreenRef.current = false;

    try {
      await fullscreen.request(document.documentElement);
      setIsFullscreenOpen(true);
    } catch (error) {
      console.error("[UsageLogsViewVirtualized] Failed to enter fullscreen", error);
      toast.error(t("logs.error.loadFailed"));
    }
  }, [fullscreen, t]);

  const handleExitFullscreen = useCallback(async () => {
    resetFullscreenState();
    await fullscreen.exit();
  }, [fullscreen, resetFullscreenState]);

  useEffect(() => {
    if (!isFullscreenOpen) return;

    if (fullscreen.isFullscreen) {
      wasInFullscreenRef.current = true;
      return;
    }

    if (wasInFullscreenRef.current) {
      resetFullscreenState();
    }
  }, [fullscreen.isFullscreen, isFullscreenOpen, resetFullscreenState]);

  useEffect(() => {
    if (!isFullscreenOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        void handleExitFullscreen();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleExitFullscreen, isFullscreenOpen]);

  const handleFilterChange = (newFilters: Omit<typeof filters, "page">) => {
    const query = buildLogsUrlQuery(newFilters);
    router.push(`/dashboard/logs?${query.toString()}`);
  };

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
    <>
      <div className="space-y-4">
        {/* Stats Summary - Collapsible */}
        <UsageLogsStatsPanel
          filters={{
            userId: filters.userId,
            keyId: filters.keyId,
            providerId: filters.providerId,
            sessionId: filters.sessionId,
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

        {/* Filter Criteria */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50">
                <Filter className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">{t("title.filterCriteria")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("title.filterCriteriaDescription")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
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

        {/* Usage Records Table */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50">
                  <ListOrdered className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">{t("title.usageLogs")}</CardTitle>
                  <CardDescription className="text-xs">
                    {t("title.usageLogsDescription")}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ColumnVisibilityDropdown
                  userId={userId}
                  tableId="usage-logs"
                  onVisibilityChange={setHiddenColumns}
                />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleEnterFullscreen()}
                  className="gap-1.5 h-8"
                  aria-label={t("logs.actions.fullscreen")}
                >
                  <Expand className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("logs.actions.fullscreen")}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualRefresh}
                  className="gap-1.5 h-8"
                  disabled={isFullscreenOpen}
                  aria-label={t("logs.actions.refresh")}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isManualRefreshing ? "animate-spin" : ""}`}
                  />
                  <span className="hidden sm:inline">{t("logs.actions.refresh")}</span>
                </Button>

                <Button
                  variant={isAutoRefresh ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                  className="gap-1.5 h-8"
                  disabled={isFullscreenOpen}
                  aria-label={
                    isAutoRefresh
                      ? t("logs.actions.stopAutoRefresh")
                      : t("logs.actions.startAutoRefresh")
                  }
                >
                  {isAutoRefresh ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t("logs.actions.stopAutoRefresh")}</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t("logs.actions.startAutoRefresh")}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            <VirtualizedLogsTable
              filters={filters}
              currencyCode={resolvedCurrencyCode}
              billingModelSource={resolvedBillingModelSource}
              autoRefreshEnabled={!isFullscreenOpen && isAutoRefresh}
              autoRefreshIntervalMs={5000}
              hiddenColumns={hiddenColumns}
            />
          </CardContent>
        </Card>
      </div>

      {isFullscreenOpen ? (
        <div
          className="fixed inset-0 z-[70] bg-background flex flex-col"
          role="dialog"
          aria-modal="true"
        >
          <div className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 flex items-center justify-between px-6 gap-4">
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight truncate">
                {systemSettings?.siteTitle ?? t("title.usageLogs")}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExitFullscreen()}
                className="gap-2"
              >
                <Minimize2 className="h-4 w-4" />
                {t("logs.actions.exitFullscreen")}
              </Button>

              <div className="hidden md:flex items-stretch h-full divide-x divide-border/50">
                <div className="px-5 flex flex-col justify-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {tc("metrics.concurrent")}
                  </div>
                  <div className="font-mono text-xl font-bold tabular-nums leading-none">
                    {overviewData?.concurrentSessions ?? 0}
                  </div>
                </div>
                <div className="px-5 flex flex-col justify-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {tc("metrics.todayRequests")}
                  </div>
                  <div className="font-mono text-xl font-bold tabular-nums leading-none">
                    {overviewData?.todayRequests ?? 0}
                  </div>
                </div>
                <div className="px-5 flex flex-col justify-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {tc("metrics.todayCost")}
                  </div>
                  <div className="font-mono text-xl font-bold tabular-nums leading-none">
                    {formatCurrency(overviewData?.todayCost ?? 0, resolvedCurrencyCode, 2)}
                  </div>
                </div>
                <div className="pl-5 flex flex-col justify-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {tc("metrics.avgResponse")}
                  </div>
                  <div className="font-mono text-xl font-bold tabular-nums leading-none">
                    {formatResponseTime(overviewData?.avgResponseTime ?? 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="group fixed top-20 right-0 z-[80] flex items-start translate-x-[calc(100%-6px)] hover:translate-x-0 focus-within:translate-x-0 transition-transform duration-300">
            <div className="w-1.5 h-16 bg-primary/20 group-hover:bg-primary/50 rounded-l-sm mt-4" />
            <div className="bg-popover border border-r-0 shadow-xl rounded-l-lg p-4 w-72 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{t("logs.table.hideProviderColumn")}</div>
                <Switch
                  checked={hideProviderColumn}
                  onCheckedChange={setHideProviderColumn}
                  aria-label={t("logs.table.hideProviderColumn")}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 p-4">
            <VirtualizedLogsTable
              filters={filters}
              currencyCode={resolvedCurrencyCode}
              billingModelSource={resolvedBillingModelSource}
              autoRefreshEnabled={true}
              autoRefreshIntervalMs={3000}
              hideStatusBar={true}
              hideScrollToTop={true}
              hiddenColumns={hideProviderColumn ? ["provider"] : undefined}
              bodyClassName="h-[calc(100vh-56px-32px-40px)]"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function UsageLogsViewVirtualized(props: UsageLogsViewVirtualizedProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <UsageLogsViewContent {...props} />
    </QueryClientProvider>
  );
}
