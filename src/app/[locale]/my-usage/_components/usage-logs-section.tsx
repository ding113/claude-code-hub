"use client";

import { ChevronDown, Filter, RefreshCw, ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogsDateRangePicker } from "@/app/[locale]/dashboard/logs/_components/logs-date-range-picker";
import {
  type LogsFetchFn,
  VirtualizedLogsTable,
  type VirtualizedLogsTableFilters,
} from "@/app/[locale]/dashboard/logs/_components/virtualized-logs-table";
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
import { meClient } from "@/lib/api-client/v1/me";
import type { LogsTableColumn } from "@/lib/column-visibility";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { parseDateRangeToTimestamps } from "@/lib/utils/date-range";
import type { MyUsageMetadata } from "@/types/my-usage";
import type { BillingModelSource } from "@/types/system-config";

/** Columns always hidden on my-usage page (user/key/provider not available) */
const MY_USAGE_HIDDEN_COLUMNS: LogsTableColumn[] = ["user", "key", "provider"];

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

// Cast through unknown because MyUsage logs have a slimmer row shape (no
// internal user/key/provider columns) that the shared VirtualizedLogsTable
// type omits via `MY_USAGE_HIDDEN_COLUMNS`. Server enforces visibility.
const myUsageFetchFn: LogsFetchFn = async (params) => {
  try {
    const { cursor, ...rest } = params;
    const queryParams: Record<string, string | number | boolean | undefined> = {
      ...rest,
      cursorCreatedAt: cursor?.createdAt,
      cursorId: cursor?.id,
    };
    const data = (await meClient.usageLogsFull(queryParams)) as unknown;
    return {
      ok: true,
      data: data as unknown as Awaited<ReturnType<LogsFetchFn>> extends { ok: true; data: infer D }
        ? D
        : never,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load usage logs",
    };
  }
};

export function UsageLogsSection({
  autoRefreshSeconds,
  defaultOpen = false,
  serverTimeZone,
}: UsageLogsSectionProps) {
  const t = useTranslations("myUsage.logs");
  const tDashboard = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [models, setModels] = useState<string[]>([]);
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isEndpointsLoading, setIsEndpointsLoading] = useState(true);
  const [draftFilters, setDraftFilters] = useState<Filters>({});
  const [appliedFilters, setAppliedFilters] = useState<Filters>({});
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>("USD");
  const [billingModelSource, setBillingModelSource] = useState<BillingModelSource>("original");

  useEffect(() => {
    setIsModelsLoading(true);
    setIsEndpointsLoading(true);

    void meClient
      .models()
      .then((data) => {
        const list = (data as unknown as { items?: string[] }).items;
        if (Array.isArray(list)) setModels(list);
      })
      .catch(() => undefined)
      .finally(() => setIsModelsLoading(false));

    void meClient
      .endpoints()
      .then((data) => {
        const list = (data as unknown as { items?: string[] }).items;
        if (Array.isArray(list)) setEndpoints(list);
      })
      .catch(() => undefined)
      .finally(() => setIsEndpointsLoading(false));

    void meClient
      .metadata()
      .then((data) => {
        const meta = data as unknown as MyUsageMetadata;
        if (meta?.currencyCode) setCurrencyCode(meta.currencyCode);
        if (meta?.billingModelSource) setBillingModelSource(meta.billingModelSource);
      })
      .catch(() => undefined);
  }, []);

  // Convert date-based filters to VirtualizedLogsTable format (timestamps)
  const tableFilters = useMemo<VirtualizedLogsTableFilters>(() => {
    const { startTime, endTime } = parseDateRangeToTimestamps(
      appliedFilters.startDate,
      appliedFilters.endDate,
      serverTimeZone
    );
    return {
      startTime,
      endTime,
      model: appliedFilters.model,
      statusCode: appliedFilters.statusCode,
      excludeStatusCode200: appliedFilters.excludeStatusCode200,
      endpoint: appliedFilters.endpoint,
      minRetryCount: appliedFilters.minRetryCount,
    };
  }, [appliedFilters, serverTimeZone]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.startDate || appliedFilters.endDate) count++;
    if (appliedFilters.model) count++;
    if (appliedFilters.endpoint) count++;
    if (appliedFilters.statusCode || appliedFilters.excludeStatusCode200) count++;
    if (appliedFilters.minRetryCount) count++;
    return count;
  }, [appliedFilters]);

  const handleFilterChange = useCallback((changes: Partial<Filters>) => {
    setDraftFilters((prev) => ({ ...prev, ...changes }));
  }, []);

  const handleApply = useCallback(() => {
    const nextFilters = { ...draftFilters };
    if (JSON.stringify(nextFilters) === JSON.stringify(appliedFilters)) {
      return;
    }
    setAppliedFilters(nextFilters);
  }, [draftFilters, appliedFilters]);

  const handleReset = useCallback(() => {
    setDraftFilters({});
    if (Object.keys(appliedFilters).length === 0) {
      return;
    }
    setAppliedFilters({});
  }, [appliedFilters]);

  const handleDateRangeChange = useCallback(
    (range: { startDate?: string; endDate?: string }) => {
      handleFilterChange(range);
    },
    [handleFilterChange]
  );

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
              <span className="text-sm font-semibold">{t("title")}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-sm">
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                    <Filter className="h-3 w-3 mr-1" />
                    {activeFiltersCount}
                  </Badge>
                )}

                {autoRefreshSeconds && (
                  <>
                    {activeFiltersCount > 0 && <span className="text-muted-foreground">|</span>}
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="text-xs text-muted-foreground">{autoRefreshSeconds}s</span>
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
              <Button size="sm" onClick={handleApply}>
                {t("filters.apply")}
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                {t("filters.reset")}
              </Button>
            </div>

            <div className="rounded-lg border border-border/60 overflow-hidden">
              <VirtualizedLogsTable
                filters={tableFilters}
                currencyCode={currencyCode}
                billingModelSource={billingModelSource}
                hiddenColumns={MY_USAGE_HIDDEN_COLUMNS}
                disableDetailDialog
                fetchFn={myUsageFetchFn}
                queryKeyPrefix="my-usage-logs-batch"
                ipLookupMode="my-usage"
                autoRefreshEnabled={!!autoRefreshSeconds}
                autoRefreshIntervalMs={autoRefreshSeconds ? autoRefreshSeconds * 1000 : undefined}
              />
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
