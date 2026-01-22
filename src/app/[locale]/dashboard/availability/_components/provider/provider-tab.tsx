"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AvailabilityQueryResult } from "@/lib/availability";
import { cn } from "@/lib/utils";
import type { TimeRangeOption } from "../availability-dashboard";
import { TimeRangeSelector } from "../shared/time-range-selector";
import { LaneChart } from "./lane-chart";
import { LatencyChart } from "./latency-chart";

interface ProviderTabProps {
  data: AvailabilityQueryResult | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  timeRange: TimeRangeOption;
  onTimeRangeChange: (value: TimeRangeOption) => void;
  onRefresh: () => void;
}

type SortOption = "availability" | "name" | "requests";

export function ProviderTab({
  data,
  loading,
  refreshing,
  error,
  timeRange,
  onTimeRangeChange,
  onRefresh,
}: ProviderTabProps) {
  const t = useTranslations("dashboard.availability");
  const [sortBy, setSortBy] = useState<SortOption>("availability");

  // Sort providers based on selected option
  const sortedProviders = useMemo(() => {
    if (!data?.providers) return [];

    return [...data.providers].sort((a, b) => {
      switch (sortBy) {
        case "availability":
          if (a.currentStatus === "unknown" && b.currentStatus !== "unknown") return 1;
          if (b.currentStatus === "unknown" && a.currentStatus !== "unknown") return -1;
          return b.currentAvailability - a.currentAvailability;
        case "name":
          return a.providerName.localeCompare(b.providerName);
        case "requests":
          return b.totalRequests - a.totalRequests;
        default:
          return 0;
      }
    });
  }, [data?.providers, sortBy]);

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Controls skeleton */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex gap-4">
            <Skeleton className="h-9 w-[200px]" />
            <Skeleton className="h-9 w-[140px]" />
          </div>
          <Skeleton className="h-9 w-[100px]" />
        </div>

        {/* Lane chart skeleton */}
        <div
          className={cn(
            "rounded-2xl p-6",
            "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
            "backdrop-blur-lg",
            "border border-border/50 dark:border-white/[0.08]"
          )}
        >
          <Skeleton className="h-6 w-48 mb-6" />
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-40" />
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 w-24" />
              </div>
            ))}
          </div>
        </div>

        {/* Latency chart skeleton */}
        <div
          className={cn(
            "rounded-2xl p-6",
            "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
            "backdrop-blur-lg",
            "border border-border/50 dark:border-white/[0.08]"
          )}
        >
          <Skeleton className="h-[250px] w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-2xl p-8 text-center",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-destructive/50"
        )}
      >
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("actions.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
          <TimeRangeSelector value={timeRange} onChange={onTimeRangeChange} />
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder={t("sort.label")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="availability">{t("sort.availability")}</SelectItem>
              <SelectItem value="name">{t("sort.name")}</SelectItem>
              <SelectItem value="requests">{t("sort.requests")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className="w-full sm:w-auto"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
          {refreshing ? t("actions.refreshing") : t("actions.refresh")}
        </Button>
      </div>

      {/* Lane Chart */}
      <div
        className={cn(
          "rounded-2xl p-4 md:p-6",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-border/50 dark:border-white/[0.08]",
          "shadow-sm",
          refreshing && "opacity-70 transition-opacity"
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{t("laneChart.title")}</h3>
          {data && (
            <span className="text-xs text-muted-foreground">
              {t("heatmap.bucketSize")}: {data.bucketSizeMinutes} {t("heatmap.minutes")}
            </span>
          )}
        </div>
        {data && (
          <LaneChart
            providers={sortedProviders}
            bucketSizeMinutes={data.bucketSizeMinutes}
            startTime={data.startTime}
            endTime={data.endTime}
          />
        )}
      </div>

      {/* Latency Distribution Chart */}
      <div
        className={cn(
          "rounded-2xl p-4 md:p-6",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-border/50 dark:border-white/[0.08]",
          "shadow-sm",
          refreshing && "opacity-70 transition-opacity"
        )}
      >
        {data && <LatencyChart providers={sortedProviders} />}
      </div>

      {/* Legend */}
      <div
        className={cn(
          "rounded-2xl p-4",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-border/50 dark:border-white/[0.08]"
        )}
      >
        <div className="flex flex-wrap gap-4 md:gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-sm bg-emerald-500" />
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
            <div className="w-4 h-4 rounded-sm bg-rose-500" />
            <span className="text-muted-foreground">{t("legend.red")}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-sm bg-slate-300 dark:bg-slate-600" />
            <span className="text-muted-foreground">{t("legend.noData")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
