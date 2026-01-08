"use client";

import { BarChart3, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMyStatsSummary, type MyStatsSummary } from "@/actions/my-usage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokenAmount } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { LogsDateRangePicker } from "../../dashboard/logs/_components/logs-date-range-picker";

interface StatisticsSummaryCardProps {
  className?: string;
  autoRefreshSeconds?: number;
}

export function StatisticsSummaryCard({
  className,
  autoRefreshSeconds = 30,
}: StatisticsSummaryCardProps) {
  const t = useTranslations("myUsage.stats");
  const [stats, setStats] = useState<MyStatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<{ startDate?: string; endDate?: string }>(() => {
    const today = new Date().toISOString().split("T")[0];
    return { startDate: today, endDate: today };
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadStats = useCallback(async () => {
    const result = await getMyStatsSummary({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
    if (result.ok) {
      setStats(result.data);
    }
  }, [dateRange.startDate, dateRange.endDate]);

  // Initial load on date range change
  useEffect(() => {
    setLoading(true);
    loadStats().finally(() => setLoading(false));
  }, [loadStats]);

  // Auto-refresh with visibility change handling
  useEffect(() => {
    const POLL_INTERVAL = autoRefreshSeconds * 1000;

    const startPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = setInterval(() => {
        loadStats();
      }, POLL_INTERVAL);
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
        loadStats();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadStats, autoRefreshSeconds]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, [loadStats]);

  const handleDateRangeChange = useCallback((range: { startDate?: string; endDate?: string }) => {
    setDateRange(range);
  }, []);

  const isLoading = loading || refreshing;
  const currencyCode = stats?.currencyCode ?? "USD";

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            {t("title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t("autoRefresh", { seconds: autoRefreshSeconds })}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <LogsDateRangePicker
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onDateRangeChange={handleDateRangeChange}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-2"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-lg border bg-card/50 p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <>
            {/* Main metrics */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              {/* Total Requests */}
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">{t("totalRequests")}</div>
                <div className="text-2xl font-mono font-semibold">
                  {stats.totalRequests.toLocaleString()}
                </div>
              </div>

              {/* Total Cost */}
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">{t("totalCost")}</div>
                <div className="text-2xl font-mono font-semibold">
                  {formatCurrency(stats.totalCost, currencyCode)}
                </div>
              </div>

              {/* Total Tokens */}
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">{t("totalTokens")}</div>
                <div className="text-2xl font-mono font-semibold">
                  {formatTokenAmount(stats.totalTokens)}
                </div>
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>{t("input")}:</span>
                    <span className="font-mono">{formatTokenAmount(stats.totalInputTokens)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("output")}:</span>
                    <span className="font-mono">{formatTokenAmount(stats.totalOutputTokens)}</span>
                  </div>
                </div>
              </div>

              {/* Cache Tokens */}
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">{t("cacheTokens")}</div>
                <div className="text-2xl font-mono font-semibold">
                  {formatTokenAmount(stats.totalCacheCreationTokens + stats.totalCacheReadTokens)}
                </div>
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>{t("write")}:</span>
                    <span className="font-mono">
                      {formatTokenAmount(stats.totalCacheCreationTokens)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("read")}:</span>
                    <span className="font-mono">
                      {formatTokenAmount(stats.totalCacheReadTokens)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Model Breakdown - 2 columns: Key | User */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">{t("modelBreakdown")}</p>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Key Stats */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("keyStats")}
                  </p>
                  {stats.keyModelBreakdown.length > 0 ? (
                    <div className="space-y-2">
                      {stats.keyModelBreakdown.map((item, index) => (
                        <ModelBreakdownRow
                          key={`key-${item.model ?? "unknown"}-${index}`}
                          model={item.model}
                          requests={item.requests}
                          cost={item.cost}
                          inputTokens={item.inputTokens}
                          outputTokens={item.outputTokens}
                          currencyCode={currencyCode}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">{t("noData")}</p>
                  )}
                </div>

                {/* User Stats */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("userStats")}
                  </p>
                  {stats.userModelBreakdown.length > 0 ? (
                    <div className="space-y-2">
                      {stats.userModelBreakdown.map((item, index) => (
                        <ModelBreakdownRow
                          key={`user-${item.model ?? "unknown"}-${index}`}
                          model={item.model}
                          requests={item.requests}
                          cost={item.cost}
                          inputTokens={item.inputTokens}
                          outputTokens={item.outputTokens}
                          currencyCode={currencyCode}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">{t("noData")}</p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">{t("noData")}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface ModelBreakdownRowProps {
  model: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  currencyCode: CurrencyCode;
}

function ModelBreakdownRow({
  model,
  requests,
  cost,
  inputTokens,
  outputTokens,
  currencyCode,
}: ModelBreakdownRowProps) {
  const t = useTranslations("myUsage.stats");

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex flex-col text-sm min-w-0">
        <span className="font-medium text-foreground truncate">{model || t("unknownModel")}</span>
        <span className="text-xs text-muted-foreground">
          {requests.toLocaleString()} req · {formatTokenAmount(inputTokens + outputTokens)} tok
        </span>
      </div>
      <div className="text-right text-sm font-semibold text-foreground whitespace-nowrap ml-2">
        {formatCurrency(cost, currencyCode)}
      </div>
    </div>
  );
}
