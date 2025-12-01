"use client";

import { Activity, CheckCircle2, HelpCircle, RefreshCw, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AvailabilityQueryResult,
  ProviderAvailabilitySummary,
  TimeBucketMetrics,
} from "@/lib/availability";
import { cn } from "@/lib/utils";

type TimeRangeOption = "15min" | "1h" | "6h" | "24h" | "7d";
type SortOption = "availability" | "name" | "requests";

// Target number of buckets to fill the heatmap width consistently
const TARGET_BUCKETS = 60;

const TIME_RANGE_MAP: Record<TimeRangeOption, number> = {
  "15min": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * Calculate bucket size to achieve target bucket count
 */
function calculateBucketSize(timeRangeMs: number): number {
  const bucketSizeMs = timeRangeMs / TARGET_BUCKETS;
  const bucketSizeMinutes = bucketSizeMs / (60 * 1000);
  // Round to reasonable precision (0.25 min = 15 seconds minimum)
  return Math.max(0.25, Math.round(bucketSizeMinutes * 4) / 4);
}

/**
 * Get color class based on availability score
 * Simple gradient: gray(no data) -> red -> green
 */
function getAvailabilityColor(score: number, hasData: boolean): string {
  if (!hasData) return "bg-slate-300 dark:bg-slate-600"; // Gray = no data

  if (score < 0.5) return "bg-red-500";
  if (score < 0.8) return "bg-orange-500";
  if (score < 0.95) return "bg-lime-500";
  return "bg-green-500";
}

/**
 * Format bucket time for display in tooltip
 */
function formatBucketTime(isoString: string, bucketSizeMinutes: number): string {
  const date = new Date(isoString);
  if (bucketSizeMinutes >= 1440) {
    // Daily buckets: show date
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (bucketSizeMinutes >= 60) {
    // Hourly buckets: show date + hour
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  // Sub-hour buckets: show full time with seconds for precision
  if (bucketSizeMinutes < 1) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  // Minute buckets: show time
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Format bucket size for display
 */
function _formatBucketSizeDisplay(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours.toFixed(1)} hours`;
  }
  if (minutes >= 1) {
    return `${Math.round(minutes)} min`;
  }
  const seconds = Math.round(minutes * 60);
  return `${seconds} sec`;
}

export function AvailabilityView() {
  const t = useTranslations("dashboard.availability");
  const [data, setData] = useState<AvailabilityQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeOption>("24h");
  const [sortBy, setSortBy] = useState<SortOption>("availability");
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const now = new Date();
      const timeRangeMs = TIME_RANGE_MAP[timeRange];
      const startTime = new Date(now.getTime() - timeRangeMs);
      const bucketSizeMinutes = calculateBucketSize(timeRangeMs);

      const params = new URLSearchParams({
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        bucketSizeMinutes: bucketSizeMinutes.toString(),
        maxBuckets: TARGET_BUCKETS.toString(),
      });

      const res = await fetch(`/api/availability?${params}`);
      if (!res.ok) {
        throw new Error(t("states.fetchFailed"));
      }

      const result: AvailabilityQueryResult = await res.json();
      setData(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch availability data:", err);
      setError(err instanceof Error ? err.message : t("states.fetchFailed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeRange, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Generate unified time buckets for all providers
  const unifiedBuckets = useMemo(() => {
    if (!data) return [];

    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);
    const bucketSizeMs = data.bucketSizeMinutes * 60 * 1000;

    const buckets: string[] = [];
    let current = new Date(Math.floor(startTime.getTime() / bucketSizeMs) * bucketSizeMs);

    while (current.getTime() < endTime.getTime()) {
      buckets.push(current.toISOString());
      current = new Date(current.getTime() + bucketSizeMs);
    }

    return buckets;
  }, [data]);

  // Sort providers based on selected option
  const sortedProviders = useMemo(() => {
    if (!data?.providers) return [];

    return [...data.providers].sort((a, b) => {
      switch (sortBy) {
        case "availability":
          // Unknown status (no data) goes to the end
          if (a.currentStatus === "unknown" && b.currentStatus !== "unknown") return 1;
          if (b.currentStatus === "unknown" && a.currentStatus !== "unknown") return -1;
          // Sort by availability descending (best first)
          return b.currentAvailability - a.currentAvailability;
        case "name":
          return a.providerName.localeCompare(b.providerName);
        case "requests":
          // Sort by requests descending (most active first)
          return b.totalRequests - a.totalRequests;
        default:
          return 0;
      }
    });
  }, [data?.providers, sortBy]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "green":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "red":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "unknown":
        return <HelpCircle className="h-4 w-4 text-slate-400" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const statusKey = status as "green" | "red" | "unknown";

    // 采用与请求日志相同的配色方案
    const getStatusClassName = () => {
      switch (status) {
        case "green":
          // 成功 - 绿色
          return "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700";
        case "red":
          // 错误 - 红色
          return "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700";
        default:
          // 未知 - 灰色
          return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
      }
    };

    return (
      <Badge variant="outline" className={`gap-1 ${getStatusClassName()}`}>
        {getStatusIcon(status)}
        {t(`status.${statusKey}`)}
      </Badge>
    );
  };

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  // Summary counts
  const getSummaryCounts = () => {
    if (!data?.providers) return { healthy: 0, unhealthy: 0, unknown: 0, total: 0 };
    return {
      healthy: data.providers.filter((p) => p.currentStatus === "green").length,
      unhealthy: data.providers.filter((p) => p.currentStatus === "red").length,
      unknown: data.providers.filter((p) => p.currentStatus === "unknown").length,
      total: data.providers.length,
    };
  };

  const summary = getSummaryCounts();

  // Get bucket data for a provider at a specific time
  const getBucketData = (
    provider: ProviderAvailabilitySummary,
    bucketStart: string
  ): TimeBucketMetrics | null => {
    return provider.timeBuckets.find((b) => b.bucketStart === bucketStart) || null;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">{t("states.loading")}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">{error}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("metrics.systemAvailability")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatPercentage(data?.systemAvailability ?? 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                {t("summary.healthyProviders")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.healthy}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-1">
                <XCircle className="h-4 w-4" />
                {t("summary.unhealthyProviders")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{summary.unhealthy}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-1">
                <HelpCircle className="h-4 w-4" />
                {t("summary.unknownProviders")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-500">{summary.unknown}</div>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRangeOption)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("timeRange.label")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15min">{t("timeRange.last15min")}</SelectItem>
                <SelectItem value="1h">{t("timeRange.last1h")}</SelectItem>
                <SelectItem value="6h">{t("timeRange.last6h")}</SelectItem>
                <SelectItem value="24h">{t("timeRange.last24h")}</SelectItem>
                <SelectItem value="7d">{t("timeRange.last7d")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("sort.label")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="availability">{t("sort.availability")}</SelectItem>
                <SelectItem value="name">{t("sort.name")}</SelectItem>
                <SelectItem value="requests">{t("sort.requests")}</SelectItem>
              </SelectContent>
            </Select>
            {data && (
              <span className="text-sm text-muted-foreground">
                {t("heatmap.bucketSize")}: {data.bucketSizeMinutes} {t("heatmap.minutes")}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            {refreshing ? t("actions.refreshing") : t("actions.refresh")}
          </Button>
        </div>

        {/* Heatmap */}
        <Card>
          <CardHeader>
            <CardTitle>{t("chart.title")}</CardTitle>
            <CardDescription>{t("chart.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {!sortedProviders.length ? (
              <div className="text-center text-muted-foreground py-8">
                {t("states.noProviders")}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Provider rows with heatmap */}
                {sortedProviders.map((provider) => (
                  <div key={provider.providerId} className="flex items-center gap-3">
                    {/* Provider name */}
                    <div className="w-40 shrink-0 flex items-center gap-2">
                      <span className="font-medium truncate text-sm" title={provider.providerName}>
                        {provider.providerName}
                      </span>
                      {getStatusBadge(provider.currentStatus)}
                    </div>

                    {/* Heatmap cells - CSS grid for responsive width */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="grid gap-px"
                        style={{
                          gridTemplateColumns: `repeat(${unifiedBuckets.length}, 1fr)`,
                        }}
                      >
                        {unifiedBuckets.map((bucketStart) => {
                          const bucket = getBucketData(provider, bucketStart);
                          const hasData = bucket !== null && bucket.totalRequests > 0;
                          const score = hasData ? bucket.availabilityScore : 0;

                          return (
                            <Tooltip key={bucketStart}>
                              <TooltipTrigger asChild>
                                <div
                                  className={cn(
                                    "h-6 rounded-[2px] cursor-pointer transition-opacity hover:opacity-80 min-w-[2px]",
                                    getAvailabilityColor(score, hasData)
                                  )}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <div className="text-sm space-y-1">
                                  <div className="font-medium">
                                    {formatBucketTime(bucketStart, data?.bucketSizeMinutes ?? 5)}
                                  </div>
                                  {hasData && bucket ? (
                                    <>
                                      <div>
                                        {t("heatmap.requests")}: {bucket.totalRequests}
                                      </div>
                                      <div>
                                        {t("columns.availability")}:{" "}
                                        {formatPercentage(bucket.availabilityScore)}
                                      </div>
                                      <div>
                                        {t("columns.avgLatency")}:{" "}
                                        {formatLatency(bucket.avgLatencyMs)}
                                      </div>
                                      <div className="flex gap-2 text-xs">
                                        <span className="text-green-500">
                                          {t("details.greenCount")}: {bucket.greenCount}
                                        </span>
                                        <span className="text-red-500">
                                          {t("details.redCount")}: {bucket.redCount}
                                        </span>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-muted-foreground">
                                      {t("heatmap.noData")}
                                    </div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>

                    {/* Summary stats */}
                    <div className="w-28 shrink-0 text-right text-sm">
                      <div className="font-mono">
                        {provider.currentStatus === "unknown"
                          ? t("heatmap.noData")
                          : formatPercentage(provider.currentAvailability)}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {provider.totalRequests > 0
                          ? `${provider.totalRequests.toLocaleString()} ${t("heatmap.requests")}`
                          : t("heatmap.noRequests")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-sm bg-green-500" />
                <span className="text-muted-foreground">{t("legend.green")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-sm bg-lime-500" />
                <span className="text-muted-foreground">{t("legend.lime")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-sm bg-orange-500" />
                <span className="text-muted-foreground">{t("legend.orange")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-sm bg-red-500" />
                <span className="text-muted-foreground">{t("legend.red")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-sm bg-slate-300 dark:bg-slate-600" />
                <span className="text-muted-foreground">{t("legend.noData")}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
