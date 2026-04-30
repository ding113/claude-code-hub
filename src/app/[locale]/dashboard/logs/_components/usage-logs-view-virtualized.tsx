"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Expand, Filter, Minimize2, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useRouter } from "@/i18n/routing";
import { getKeys } from "@/lib/api-client/v1/actions/keys";
import type { OverviewData } from "@/lib/api-client/v1/actions/overview";
import { getOverviewData } from "@/lib/api-client/v1/actions/overview";
import { getProviders } from "@/lib/api-client/v1/actions/providers";
import { getSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import { getHiddenColumns, type LogsTableColumn } from "@/lib/column-visibility";
import { cn } from "@/lib/utils";
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

const EMPTY_PROVIDERS: ProviderDisplay[] = [];
const EMPTY_KEYS: Key[] = [];

interface UsageLogsViewVirtualizedProps {
  isAdmin: boolean;
  userId: number;
  providers?: ProviderDisplay[];
  initialKeys?: Key[];
  searchParams: { [key: string]: string | string[] | undefined };
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
  serverTimeZone?: string;
  logsRefreshIntervalMs?: number;
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
  searchParams: _searchParams, // Kept for SSR hydration, but filters use useSearchParams
  currencyCode = "USD",
  billingModelSource = "original",
  serverTimeZone,
  logsRefreshIntervalMs,
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
    queryFn: getSystemSettings,
    enabled: shouldFetchSettings || isFullscreenOpen,
  });

  const resolvedCurrencyCode = currencyCode ?? systemSettings?.currencyDisplay ?? "USD";
  const resolvedBillingModelSource =
    billingModelSource ?? systemSettings?.billingModelSource ?? "original";

  const { data: providersData = EMPTY_PROVIDERS, isLoading: isProvidersLoading } = useQuery<
    ProviderDisplay[]
  >({
    queryKey: ["usage-log-providers"],
    queryFn: getProviders,
    enabled: isAdmin && providers === undefined,
    placeholderData: EMPTY_PROVIDERS,
  });

  const { data: keysResult, isLoading: isKeysLoading } = useQuery({
    queryKey: ["usage-log-keys", userId],
    queryFn: () => getKeys(userId),
    enabled: !isAdmin && initialKeys === undefined,
  });

  const resolvedProviders = providers ?? providersData;
  const resolvedKeys =
    initialKeys ?? (keysResult?.ok && keysResult.data ? keysResult.data : EMPTY_KEYS);

  // Use useSearchParams hook for client-side URL reactivity
  // Note: searchParams props from server don't update on client-side navigation
  const filters = useMemo<VirtualizedLogsTableFilters>(() => {
    const { page: _page, ...parsed } = parseLogsUrlFilters({
      userId: _params.get("userId") ?? undefined,
      keyId: _params.get("keyId") ?? undefined,
      providerId: _params.get("providerId") ?? undefined,
      sessionId: _params.get("sessionId") ?? undefined,
      startTime: _params.get("startTime") ?? undefined,
      endTime: _params.get("endTime") ?? undefined,
      statusCode: _params.get("statusCode") ?? undefined,
      model: _params.get("model") ?? undefined,
      endpoint: _params.get("endpoint") ?? undefined,
      minRetry: _params.get("minRetry") ?? undefined,
      page: _params.get("page") ?? undefined,
    });

    return parsed;
  }, [_params]);

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
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const statsFilters = filters;

  const hasStatsFilters = Object.values(statsFilters).some((v) => v !== undefined && v !== false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statsFilters.startTime || statsFilters.endTime) count++;
    if (statsFilters.userId !== undefined) count++;
    if (statsFilters.keyId !== undefined) count++;
    if (statsFilters.providerId !== undefined) count++;
    if (statsFilters.sessionId) count++;
    if (statsFilters.statusCode !== undefined || statsFilters.excludeStatusCode200) count++;
    if (statsFilters.model) count++;
    if (statsFilters.endpoint) count++;
    if (statsFilters.minRetryCount !== undefined && statsFilters.minRetryCount > 0) count++;
    return count;
  }, [statsFilters]);
  const [isFilterOpen, setIsFilterOpen] = useState(activeFilterCount > 0);

  return (
    <>
      <div className="space-y-3">
        {/* Stats Summary */}
        {hasStatsFilters && (
          <UsageLogsStatsPanel filters={statsFilters} currencyCode={resolvedCurrencyCode} />
        )}

        {/* Toolbar + Filter */}
        <Collapsible open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <div className="flex items-center justify-between gap-3">
            {/* Left: Filter trigger */}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-border cursor-pointer select-none transition-colors"
              >
                <Filter className="h-3.5 w-3.5" />
                <span>{t("title.filterCriteria")}</span>
                {activeFilterCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary text-[10px] h-4.5 min-w-[18px] px-1 rounded-full"
                  >
                    {activeFilterCount}
                  </Badge>
                )}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200",
                    isFilterOpen && "rotate-180"
                  )}
                />
              </button>
            </CollapsibleTrigger>

            {/* Right: Table controls */}
            <div className="flex items-center gap-1">
              <ColumnVisibilityDropdown
                userId={userId}
                tableId="usage-logs"
                onVisibilityChange={setHiddenColumns}
              />

              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleEnterFullscreen()}
                className="h-8 w-8"
                aria-label={t("logs.actions.fullscreen")}
              >
                <Expand className="h-3.5 w-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleManualRefresh}
                className="h-8 w-8"
                disabled={isFullscreenOpen}
                aria-label={t("logs.actions.refresh")}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isManualRefreshing && "animate-spin")} />
              </Button>

              <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-border/40">
                {isAutoRefresh && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                )}
                <Switch
                  checked={isAutoRefresh}
                  onCheckedChange={setIsAutoRefresh}
                  disabled={isFullscreenOpen}
                  aria-label={
                    isAutoRefresh
                      ? t("logs.actions.stopAutoRefresh")
                      : t("logs.actions.startAutoRefresh")
                  }
                />
              </div>
            </div>
          </div>

          <CollapsibleContent forceMount className={cn(!isFilterOpen && "hidden")}>
            <div className="mt-3 rounded-lg border border-border/60 bg-card p-4">
              <UsageLogsFilters
                isAdmin={isAdmin}
                providers={resolvedProviders}
                initialKeys={resolvedKeys}
                filters={filters}
                onChange={handleFilterChange}
                onReset={() => router.push("/dashboard/logs")}
                isProvidersLoading={isProvidersLoading}
                isKeysLoading={isKeysLoading}
                serverTimeZone={serverTimeZone}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Table */}
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <VirtualizedLogsTable
            filters={filters}
            currencyCode={resolvedCurrencyCode}
            billingModelSource={resolvedBillingModelSource}
            autoRefreshEnabled={!isFullscreenOpen && isAutoRefresh}
            autoRefreshIntervalMs={logsRefreshIntervalMs ?? 5000}
            hiddenColumns={hiddenColumns}
          />
        </div>
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
              bodyClassName="h-[calc(var(--cch-viewport-height,100vh)_-_56px_-_32px_-_40px)]"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function UsageLogsViewVirtualized(props: UsageLogsViewVirtualizedProps) {
  return <UsageLogsViewContent {...props} />;
}
