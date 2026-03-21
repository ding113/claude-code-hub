"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Filter, Loader2, RefreshCw, ScrollText, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getMyAvailableEndpoints,
  getMyAvailableModels,
  getMyUsageLogsBatch,
} from "@/actions/my-usage";
import { LogsDateRangePicker } from "@/app/[locale]/dashboard/logs/_components/logs-date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { UsageLogsTable } from "./usage-logs-table";

const BATCH_SIZE = 20;

interface UsageLogsSectionProps {
  autoRefreshSeconds?: number;
  defaultOpen?: boolean;
  serverTimeZone?: string;
}

interface Filters {
  startDate?: string;
  endDate?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
}

export function UsageLogsSection({
  autoRefreshSeconds,
  defaultOpen = false,
  serverTimeZone,
}: UsageLogsSectionProps) {
  const t = useTranslations("myUsage.logs");
  const tCollapsible = useTranslations("myUsage.logsCollapsible");
  const tDashboard = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [models, setModels] = useState<string[]>([]);
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isEndpointsLoading, setIsEndpointsLoading] = useState(true);
  const [draftFilters, setDraftFilters] = useState<Filters>({});
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [isBrowsingHistory, setIsBrowsingHistory] = useState(false);

  useEffect(() => {
    setIsModelsLoading(true);
    setIsEndpointsLoading(true);

    void getMyAvailableModels()
      .then((modelsResult) => {
        if (modelsResult.ok && modelsResult.data) {
          setModels(modelsResult.data);
        }
      })
      .finally(() => setIsModelsLoading(false));

    void getMyAvailableEndpoints()
      .then((endpointsResult) => {
        if (endpointsResult.ok && endpointsResult.data) {
          setEndpoints(endpointsResult.data);
        }
      })
      .finally(() => setIsEndpointsLoading(false));
  }, []);

  const query = useInfiniteQuery({
    queryKey: ["my-usage-logs-batch", appliedFilters],
    queryFn: async ({ pageParam }) => {
      const result = await getMyUsageLogsBatch({
        ...appliedFilters,
        cursor: pageParam,
        limit: BATCH_SIZE,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data;
    },
    initialPageParam: undefined as { createdAt: string; id: number } | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefreshSeconds
      ? (query) => {
          if (isBrowsingHistory) return false;
          if (query.state.fetchStatus !== "idle") return false;
          return autoRefreshSeconds * 1000;
        }
      : false,
  });
  const {
    data,
    fetchNextPage,
    hasNextPage = false,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    isRefetching = false,
  } = query;
  const refetch = query.refetch ?? (async (): Promise<unknown> => undefined);

  const logs = useMemo(() => data?.pages.flatMap((page) => page.logs) ?? [], [data]);
  const latestPage = data?.pages[0];

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.startDate || appliedFilters.endDate) count++;
    if (appliedFilters.model) count++;
    if (appliedFilters.endpoint) count++;
    if (appliedFilters.statusCode || appliedFilters.excludeStatusCode200) count++;
    if (appliedFilters.minRetryCount) count++;
    return count;
  }, [appliedFilters]);

  const lastLog = logs[0] ?? null;

  const lastStatusText = useMemo(() => {
    if (!lastLog?.createdAt) return null;
    const now = new Date();
    const logTime = new Date(lastLog.createdAt);
    const diffMs = now.getTime() - logTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }, [lastLog]);

  const successRate = useMemo(() => {
    if (logs.length === 0) return null;
    const successCount = logs.filter((log) => log.statusCode && log.statusCode < 400).length;
    return Math.round((successCount / logs.length) * 100);
  }, [logs]);

  const lastStatusColor = useMemo(() => {
    if (!lastLog?.statusCode) return "";
    if (lastLog.statusCode === 200) return "text-green-600 dark:text-green-400";
    if (lastLog.statusCode >= 400) return "text-red-600 dark:text-red-400";
    return "";
  }, [lastLog]);

  const handleFilterChange = (changes: Partial<Filters>) => {
    setDraftFilters((prev) => ({ ...prev, ...changes }));
  };

  const handleApply = () => {
    const nextFilters = { ...draftFilters };
    if (JSON.stringify(nextFilters) === JSON.stringify(appliedFilters)) {
      void refetch();
      return;
    }
    setAppliedFilters(nextFilters);
  };

  const handleReset = () => {
    setDraftFilters({});
    if (Object.keys(appliedFilters).length === 0) {
      void refetch();
      return;
    }
    setAppliedFilters({});
  };

  const handleDateRangeChange = (range: { startDate?: string; endDate?: string }) => {
    handleFilterChange(range);
  };

  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const isRefreshing = isRefetching && !isFetchingNextPage && logs.length > 0;
  const errorMessage = isError ? (error instanceof Error ? error.message : t("loadFailed")) : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center justify-between gap-4 p-4",
              "hover:bg-muted/50 transition-colors",
              isOpen && "border-b"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <ScrollText className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">{tCollapsible("title")}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-sm">
                {lastLog ? (
                  <span className={cn("font-mono", lastStatusColor)}>
                    {tCollapsible("lastStatus", {
                      code: lastLog.statusCode ?? "-",
                      time: lastStatusText ?? "-",
                    })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{tCollapsible("noData")}</span>
                )}

                <span className="text-muted-foreground">|</span>

                {successRate !== null ? (
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      successRate >= 80
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {successRate >= 80 ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {tCollapsible("successRate", { rate: successRate })}
                  </span>
                ) : null}

                {activeFiltersCount > 0 && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                      <Filter className="h-3 w-3 mr-1" />
                      {activeFiltersCount}
                    </Badge>
                  </>
                )}

                {autoRefreshSeconds && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                    <span className="text-xs text-muted-foreground">{autoRefreshSeconds}s</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs sm:hidden">
                {lastLog ? (
                  <span className={cn("font-mono", lastStatusColor)}>
                    {lastLog.statusCode ?? "-"} ({lastStatusText ?? "-"})
                  </span>
                ) : (
                  <span className="text-muted-foreground">{tCollapsible("noData")}</span>
                )}

                <span className="text-muted-foreground">|</span>

                {successRate !== null ? (
                  <span
                    className={cn(
                      "flex items-center gap-0.5",
                      successRate >= 80 ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {successRate >= 80 ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {successRate}%
                  </span>
                ) : null}

                {activeFiltersCount > 0 && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {activeFiltersCount}
                    </Badge>
                  </>
                )}
                {autoRefreshSeconds && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
                  </>
                )}
              </div>

              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
              <div className="space-y-1.5 lg:col-span-4">
                <Label>
                  {t("filters.startDate")} / {t("filters.endDate")}
                </Label>
                <LogsDateRangePicker
                  startDate={draftFilters.startDate}
                  endDate={draftFilters.endDate}
                  onDateRangeChange={handleDateRangeChange}
                  serverTimeZone={serverTimeZone}
                />
              </div>
              <div className="space-y-1.5 lg:col-span-4">
                <Label>{t("filters.model")}</Label>
                <Select
                  value={draftFilters.model ?? "__all__"}
                  onValueChange={(value) =>
                    handleFilterChange({ model: value === "__all__" ? undefined : value })
                  }
                  disabled={isModelsLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={isModelsLoading ? tCommon("loading") : t("filters.allModels")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("filters.allModels")}</SelectItem>
                    {models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 lg:col-span-4">
                <Label>{tDashboard("logs.filters.endpoint")}</Label>
                <Select
                  value={draftFilters.endpoint ?? "__all__"}
                  onValueChange={(value) =>
                    handleFilterChange({ endpoint: value === "__all__" ? undefined : value })
                  }
                  disabled={isEndpointsLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isEndpointsLoading
                          ? tCommon("loading")
                          : tDashboard("logs.filters.allEndpoints")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">
                      {tDashboard("logs.filters.allEndpoints")}
                    </SelectItem>
                    {endpoints.map((endpoint) => (
                      <SelectItem key={endpoint} value={endpoint}>
                        {endpoint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 lg:col-span-4">
                <Label>{t("filters.status")}</Label>
                <Select
                  value={
                    draftFilters.excludeStatusCode200
                      ? "!200"
                      : (draftFilters.statusCode?.toString() ?? "__all__")
                  }
                  onValueChange={(value) =>
                    handleFilterChange({
                      statusCode:
                        value === "__all__" || value === "!200"
                          ? undefined
                          : Number.parseInt(value, 10),
                      excludeStatusCode200: value === "!200",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("filters.allStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("filters.allStatus")}</SelectItem>
                    <SelectItem value="!200">{tDashboard("logs.statusCodes.not200")}</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="400">400</SelectItem>
                    <SelectItem value="401">401</SelectItem>
                    <SelectItem value="429">429</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 lg:col-span-4">
                <Label>{tDashboard("logs.filters.minRetryCount")}</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={draftFilters.minRetryCount?.toString() ?? ""}
                  placeholder={tDashboard("logs.filters.minRetryCountPlaceholder")}
                  onChange={(e) =>
                    handleFilterChange({
                      minRetryCount: e.target.value
                        ? Number.parseInt(e.target.value, 10)
                        : undefined,
                    })
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleApply} disabled={isLoading}>
                {t("filters.apply")}
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset} disabled={isLoading}>
                {t("filters.reset")}
              </Button>
            </div>

            {isRefreshing ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{tCommon("loading")}</span>
              </div>
            ) : null}

            <UsageLogsTable
              logs={logs}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              currencyCode={latestPage?.currencyCode}
              loading={isLoading}
              loadingLabel={tCommon("loading")}
              errorMessage={errorMessage}
              onLoadMore={handleLoadMore}
              resetScrollKey={appliedFilters}
              onHistoryBrowsingChange={setIsBrowsingHistory}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
