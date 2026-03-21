"use client";

import { Check, ChevronDown, Filter, RefreshCw, ScrollText, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getMyAvailableEndpoints,
  getMyAvailableModels,
  type MyUsageLogsBatchFilters,
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
import type { CurrencyCode } from "@/lib/utils/currency";
import { type FirstPageData, VirtualizedUsageLogsTable } from "./virtualized-usage-logs-table";

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

  // 从 VirtualizedTable 回调获取首页数据, 用于 header 摘要
  const [firstPageData, setFirstPageData] = useState<FirstPageData | null>(null);
  const handleFirstPageData = useCallback((data: FirstPageData) => {
    setFirstPageData(data);
  }, []);

  const tableFilters: MyUsageLogsBatchFilters = useMemo(
    () => ({
      startDate: appliedFilters.startDate,
      endDate: appliedFilters.endDate,
      model: appliedFilters.model,
      statusCode: appliedFilters.statusCode,
      excludeStatusCode200: appliedFilters.excludeStatusCode200,
      endpoint: appliedFilters.endpoint,
      minRetryCount: appliedFilters.minRetryCount,
    }),
    [appliedFilters]
  );

  // Header 摘要统计 (基于最近一批数据, 反映近期请求状态)
  const firstPageLogs = firstPageData?.logs ?? [];
  const isFetching = firstPageData?.isFetching ?? false;

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.startDate || appliedFilters.endDate) count++;
    if (appliedFilters.model) count++;
    if (appliedFilters.endpoint) count++;
    if (appliedFilters.statusCode || appliedFilters.excludeStatusCode200) count++;
    if (appliedFilters.minRetryCount) count++;
    return count;
  }, [appliedFilters]);

  const lastLog = useMemo(() => {
    if (firstPageLogs.length === 0) return null;
    return firstPageLogs[0];
  }, [firstPageLogs]);

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
    if (firstPageLogs.length === 0) return null;
    const successCount = firstPageLogs.filter(
      (log) => log.statusCode && log.statusCode < 400
    ).length;
    return Math.round((successCount / firstPageLogs.length) * 100);
  }, [firstPageLogs]);

  const lastStatusColor = useMemo(() => {
    if (!lastLog?.statusCode) return "";
    if (lastLog.statusCode === 200) return "text-green-600 dark:text-green-400";
    if (lastLog.statusCode >= 400) return "text-red-600 dark:text-red-400";
    return "";
  }, [lastLog]);

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

  const handleFilterChange = (changes: Partial<Filters>) => {
    setDraftFilters((prev) => ({ ...prev, ...changes }));
  };

  const handleApply = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const handleReset = () => {
    setDraftFilters({});
    setAppliedFilters({});
  };

  const handleDateRangeChange = (range: { startDate?: string; endDate?: string }) => {
    handleFilterChange(range);
  };

  const autoRefreshMs = autoRefreshSeconds ? autoRefreshSeconds * 1000 : undefined;

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
            {/* Icon + Title */}
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <ScrollText className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">{tCollapsible("title")}</span>
            </div>

            {/* Header Summary */}
            <div className="flex items-center gap-3">
              {/* Desktop Summary */}
              <div className="hidden sm:flex items-center gap-2 text-sm">
                {/* Last Status */}
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

                {/* Success Rate */}
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

                {/* Active Filters Badge */}
                {activeFiltersCount > 0 && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                      <Filter className="h-3 w-3 mr-1" />
                      {activeFiltersCount}
                    </Badge>
                  </>
                )}

                {/* Auto-refresh */}
                {autoRefreshSeconds && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
                    <span className="text-xs text-muted-foreground">{autoRefreshSeconds}s</span>
                  </>
                )}
              </div>

              {/* Mobile Summary */}
              <div className="flex items-center gap-1.5 text-xs sm:hidden">
                {/* Last Status - compact */}
                {lastLog ? (
                  <span className={cn("font-mono", lastStatusColor)}>
                    {lastLog.statusCode ?? "-"} ({lastStatusText ?? "-"})
                  </span>
                ) : (
                  <span className="text-muted-foreground">{tCollapsible("noData")}</span>
                )}

                <span className="text-muted-foreground">|</span>

                {/* Success Rate - compact */}
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

                {/* Filters + Refresh */}
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
                    <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
                  </>
                )}
              </div>

              {/* Chevron */}
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
                    handleFilterChange({
                      model: value === "__all__" ? undefined : value,
                    })
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
                    handleFilterChange({
                      endpoint: value === "__all__" ? undefined : value,
                    })
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
                        value === "__all__" || value === "!200" ? undefined : parseInt(value, 10),
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
                      minRetryCount: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleApply} disabled={isFetching}>
                {t("filters.apply")}
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset} disabled={isFetching}>
                {t("filters.reset")}
              </Button>
            </div>

            <VirtualizedUsageLogsTable
              filters={tableFilters}
              currencyCode={firstPageData?.currencyCode as CurrencyCode | undefined}
              autoRefreshEnabled={Boolean(autoRefreshSeconds)}
              autoRefreshIntervalMs={autoRefreshMs}
              onFirstPageData={handleFirstPageData}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
