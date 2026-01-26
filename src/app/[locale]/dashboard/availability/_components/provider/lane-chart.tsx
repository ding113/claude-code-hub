"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProviderAvailabilitySummary, TimeBucketMetrics } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "./confidence-badge";

interface LaneChartProps {
  providers: ProviderAvailabilitySummary[];
  bucketSizeMinutes: number;
  startTime: string;
  endTime: string;
  onProviderClick?: (providerId: number) => void;
  className?: string;
}

// Threshold for switching between dots and bars visualization
const HIGH_VOLUME_THRESHOLD = 50;

function getAvailabilityColor(score: number, hasData: boolean): string {
  if (!hasData) return "bg-slate-300/50 dark:bg-slate-600/50";
  if (score < 0.5) return "bg-rose-500";
  if (score < 0.8) return "bg-orange-500";
  if (score < 0.95) return "bg-lime-500";
  return "bg-emerald-500";
}

function getStatusColor(status: string): string {
  switch (status) {
    case "green":
      return "text-emerald-500";
    case "red":
      return "text-rose-500";
    default:
      return "text-slate-400";
  }
}

function formatBucketTime(isoString: string, bucketSizeMinutes: number): string {
  const date = new Date(isoString);
  if (bucketSizeMinutes >= 1440) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (bucketSizeMinutes >= 60) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (bucketSizeMinutes < 1) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function LaneChart({
  providers,
  bucketSizeMinutes,
  startTime,
  endTime,
  onProviderClick,
  className,
}: LaneChartProps) {
  const t = useTranslations("dashboard.availability.laneChart");

  // Generate unified time buckets
  const unifiedBuckets = useMemo(() => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const bucketSizeMs = bucketSizeMinutes * 60 * 1000;

    const buckets: string[] = [];
    let current = new Date(Math.floor(start.getTime() / bucketSizeMs) * bucketSizeMs);

    while (current.getTime() < end.getTime()) {
      buckets.push(current.toISOString());
      current = new Date(current.getTime() + bucketSizeMs);
    }

    return buckets;
  }, [startTime, endTime, bucketSizeMinutes]);

  // Generate time labels (show ~7 labels)
  const timeLabels = useMemo(() => {
    if (unifiedBuckets.length === 0) return [];
    const step = Math.max(1, Math.floor(unifiedBuckets.length / 6));
    const labels: { position: number; label: string }[] = [];

    for (let i = 0; i < unifiedBuckets.length; i += step) {
      labels.push({
        position: (i / unifiedBuckets.length) * 100,
        label: formatBucketTime(unifiedBuckets[i], bucketSizeMinutes),
      });
    }

    return labels;
  }, [unifiedBuckets, bucketSizeMinutes]);

  const getBucketData = (
    provider: ProviderAvailabilitySummary,
    bucketStart: string
  ): TimeBucketMetrics | null => {
    return provider.timeBuckets.find((b) => b.bucketStart === bucketStart) || null;
  };

  if (providers.length === 0) {
    return <div className="text-center text-muted-foreground py-12">{t("noData")}</div>;
  }

  return (
    <TooltipProvider>
      <div className={cn("space-y-1", className)}>
        {/* Time labels header */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-32 md:w-40 shrink-0" />
          <div className="flex-1 relative h-6">
            {timeLabels.map((label, i) => (
              <span
                key={i}
                className="absolute text-xs font-mono text-muted-foreground transform -translate-x-1/2"
                style={{ left: `${label.position}%` }}
              >
                {label.label}
              </span>
            ))}
          </div>
          <div className="w-24 md:w-28 shrink-0" />
        </div>

        {/* Provider lanes */}
        {providers.map((provider) => {
          const isHighVolume = provider.totalRequests >= HIGH_VOLUME_THRESHOLD;

          return (
            <div
              key={provider.providerId}
              className={cn(
                "flex items-center gap-4 py-2 px-2 rounded-lg",
                "hover:bg-muted/30 transition-colors",
                onProviderClick && "cursor-pointer"
              )}
              onClick={() => onProviderClick?.(provider.providerId)}
            >
              {/* Provider info */}
              <div className="w-32 md:w-40 shrink-0 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      provider.currentStatus === "green" && "bg-emerald-500",
                      provider.currentStatus === "red" && "bg-rose-500",
                      provider.currentStatus === "unknown" && "bg-slate-400"
                    )}
                  />
                  <span className="font-medium text-sm truncate" title={provider.providerName}>
                    {provider.providerName}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <ConfidenceBadge requestCount={provider.totalRequests} />
                  <span className="text-xs text-muted-foreground">
                    {isHighVolume ? t("denseData") : t("sparseData")}
                  </span>
                </div>
              </div>

              {/* Lane visualization */}
              <div className="flex-1 h-10 bg-muted/20 dark:bg-black/40 rounded relative overflow-hidden border border-border/30">
                {/* Grid lines */}
                <div className="absolute inset-0 grid grid-cols-6 divide-x divide-border/20 pointer-events-none" />

                {/* Data visualization */}
                <div className="absolute inset-0 flex items-center px-1">
                  {isHighVolume ? (
                    // High volume: solid bars
                    <div className="flex items-end gap-px w-full h-8">
                      {unifiedBuckets.map((bucketStart) => {
                        const bucket = getBucketData(provider, bucketStart);
                        const hasData = bucket !== null && bucket.totalRequests > 0;
                        const score = hasData ? bucket.availabilityScore : 0;
                        const height = hasData
                          ? Math.max(20, Math.min(100, bucket.totalRequests / 2))
                          : 0;

                        return (
                          <Tooltip key={bucketStart}>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "flex-1 rounded-sm transition-all hover:opacity-80 cursor-crosshair",
                                  hasData ? getAvailabilityColor(score, hasData) : "bg-transparent"
                                )}
                                style={{ height: hasData ? `${height}%` : "2px" }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <BucketTooltip
                                bucketStart={bucketStart}
                                bucket={bucket}
                                bucketSizeMinutes={bucketSizeMinutes}
                              />
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ) : (
                    // Low volume: scatter dots
                    <div className="relative w-full h-full">
                      {unifiedBuckets.map((bucketStart, index) => {
                        const bucket = getBucketData(provider, bucketStart);
                        const hasData = bucket !== null && bucket.totalRequests > 0;
                        if (!hasData) return null;

                        const score = bucket.availabilityScore;
                        const size = Math.max(6, Math.min(12, bucket.totalRequests * 2));
                        const position = (index / unifiedBuckets.length) * 100;

                        return (
                          <Tooltip key={bucketStart}>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "absolute top-1/2 -translate-y-1/2 rounded-full cursor-pointer",
                                  "hover:scale-150 transition-transform",
                                  "shadow-[0_0_8px_rgba(var(--primary),0.5)]",
                                  getAvailabilityColor(score, true)
                                )}
                                style={{
                                  left: `${position}%`,
                                  width: size,
                                  height: size,
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <BucketTooltip
                                bucketStart={bucketStart}
                                bucket={bucket}
                                bucketSizeMinutes={bucketSizeMinutes}
                              />
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                      {/* No data indicator */}
                      {provider.totalRequests === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="border-t border-dashed border-slate-400/50 w-full" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Summary stats */}
              <div className="w-24 md:w-28 shrink-0 text-right">
                <div
                  className={cn(
                    "font-mono text-sm font-medium",
                    getStatusColor(provider.currentStatus)
                  )}
                >
                  {provider.currentStatus === "unknown"
                    ? t("noData")
                    : formatPercentage(provider.currentAvailability)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {provider.totalRequests > 0
                    ? t("requests", { count: provider.totalRequests.toLocaleString() })
                    : t("noRequests")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function BucketTooltip({
  bucketStart,
  bucket,
  bucketSizeMinutes,
}: {
  bucketStart: string;
  bucket: TimeBucketMetrics | null;
  bucketSizeMinutes: number;
}) {
  const t = useTranslations("dashboard.availability.laneChart");
  const hasData = bucket !== null && bucket.totalRequests > 0;

  return (
    <div className="text-sm space-y-1">
      <div className="font-medium">{formatBucketTime(bucketStart, bucketSizeMinutes)}</div>
      {hasData && bucket ? (
        <>
          <div>{t("requests", { count: bucket.totalRequests })}</div>
          <div>{t("availability", { value: formatPercentage(bucket.availabilityScore) })}</div>
          <div>
            {t("latency")}: {formatLatency(bucket.avgLatencyMs)}
          </div>
          <div className="flex gap-2 text-xs">
            <span className="text-emerald-500">OK: {bucket.greenCount}</span>
            <span className="text-rose-500">ERR: {bucket.redCount}</span>
          </div>
        </>
      ) : (
        <div className="text-muted-foreground">{t("noData")}</div>
      )}
    </div>
  );
}
