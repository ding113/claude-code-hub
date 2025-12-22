"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  getMyAvailableEndpoints,
  getMyAvailableModels,
  getMyUsageLogs,
  type MyUsageLogsResult,
} from "@/actions/my-usage";
import { LogsDateRangePicker } from "@/app/[locale]/dashboard/logs/_components/logs-date-range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UsageLogsTable } from "./usage-logs-table";

interface UsageLogsSectionProps {
  initialData?: MyUsageLogsResult | null;
  loading?: boolean;
  autoRefreshSeconds?: number;
}

interface Filters {
  startDate?: string;
  endDate?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
  page?: number;
}

export function UsageLogsSection({
  initialData = null,
  loading = false,
  autoRefreshSeconds,
}: UsageLogsSectionProps) {
  const t = useTranslations("myUsage.logs");
  const tDashboard = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [models, setModels] = useState<string[]>([]);
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isEndpointsLoading, setIsEndpointsLoading] = useState(true);
  const [draftFilters, setDraftFilters] = useState<Filters>({ page: 1 });
  const [appliedFilters, setAppliedFilters] = useState<Filters>({ page: 1 });
  const [data, setData] = useState<MyUsageLogsResult | null>(initialData);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Sync initialData from parent when it becomes available
  // (useState only uses initialData on first mount, not on subsequent updates)
  useEffect(() => {
    if (initialData && !data) {
      setData(initialData);
    }
  }, [initialData, data]);

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

  const loadLogs = useCallback(
    (nextFilters: Filters) => {
      startTransition(async () => {
        const result = await getMyUsageLogs(nextFilters);
        if (result.ok && result.data) {
          setData(result.data);
          setAppliedFilters(nextFilters);
          setError(null);
        } else {
          setError(!result.ok && "error" in result ? result.error : t("loadFailed"));
        }
      });
    },
    [t]
  );

  useEffect(() => {
    // initial load if not provided
    if (data) return;
    if (!initialData && !loading) {
      loadLogs({ page: 1 });
    }
  }, [data, initialData, loading, loadLogs]);

  // Auto-refresh polling (only when on page 1 to avoid disrupting history browsing)
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!autoRefreshSeconds || autoRefreshSeconds <= 0) {
      return;
    }

    const pollIntervalMs = autoRefreshSeconds * 1000;

    const startPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(() => {
        // Only auto-refresh when on page 1
        if ((appliedFilters.page ?? 1) === 1) {
          loadLogs(appliedFilters);
        }
      }, pollIntervalMs);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Refresh immediately when tab becomes visible (only if on page 1)
        if ((appliedFilters.page ?? 1) === 1) {
          loadLogs(appliedFilters);
        }
        startPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefreshSeconds, appliedFilters, loadLogs]);

  const handleFilterChange = (changes: Partial<Filters>) => {
    setDraftFilters((prev) => ({ ...prev, ...changes, page: 1 }));
  };

  const handleApply = () => {
    loadLogs({ ...draftFilters, page: 1 });
  };

  const handleReset = () => {
    setDraftFilters({ page: 1 });
    loadLogs({ page: 1 });
  };

  const handleDateRangeChange = (range: { startDate?: string; endDate?: string }) => {
    handleFilterChange(range);
  };

  const handlePageChange = (page: number) => {
    loadLogs({ ...appliedFilters, page });
  };

  const isInitialLoading = loading || (!data && isPending);
  const isRefreshing = isPending && Boolean(data);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("title")}</CardTitle>
        {autoRefreshSeconds ? (
          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
            {t("autoRefresh", { seconds: autoRefreshSeconds })}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          <div className="space-y-1.5 lg:col-span-4">
            <Label>
              {t("filters.startDate")} / {t("filters.endDate")}
            </Label>
            <LogsDateRangePicker
              startDate={draftFilters.startDate}
              endDate={draftFilters.endDate}
              onDateRangeChange={handleDateRangeChange}
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
                <SelectItem value="__all__">{tDashboard("logs.filters.allEndpoints")}</SelectItem>
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
          <Button size="sm" onClick={handleApply} disabled={isPending || loading}>
            {t("filters.apply")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset} disabled={isPending || loading}>
            {t("filters.reset")}
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {isRefreshing ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{tCommon("loading")}</span>
          </div>
        ) : null}

        <UsageLogsTable
          logs={data?.logs ?? []}
          total={data?.total ?? 0}
          page={appliedFilters.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          onPageChange={handlePageChange}
          currencyCode={data?.currencyCode}
          loading={isInitialLoading}
          loadingLabel={tCommon("loading")}
        />
      </CardContent>
    </Card>
  );
}
