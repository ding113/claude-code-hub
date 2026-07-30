"use client";

import { Clock, Gauge, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { CircularProgress } from "@/components/ui/circular-progress";
import { cn, formatTokenAmount } from "@/lib/utils";
import { calculateOutputRate, shouldHideOutputRate } from "@/lib/utils/performance-formatter";
import type { PerformanceTabProps } from "../types";
import { LatencyBreakdownBar } from "./LatencyBreakdownBar";

/**
 * Get TFFT performance assessment
 * Thresholds: <1s excellent, <2s good, <3s warning, >=3s poor
 */
function getTfftAssessment(tfftMs: number | null): {
  label: string;
  color: string;
  bgColor: string;
} | null {
  if (tfftMs === null) return null;

  if (tfftMs < 1000) {
    return {
      label: "excellent",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/20",
    };
  }
  if (tfftMs < 2000) {
    return {
      label: "good",
      color: "text-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-950/20",
    };
  }
  if (tfftMs < 3000) {
    return {
      label: "warning",
      color: "text-amber-600",
      bgColor: "bg-amber-50 dark:bg-amber-950/20",
    };
  }
  return {
    label: "poor",
    color: "text-rose-600",
    bgColor: "bg-rose-50 dark:bg-rose-950/20",
  };
}

/**
 * Get output rate assessment
 */
function getOutputRateAssessment(rate: number | null): {
  label: string;
  color: string;
  bgColor: string;
} | null {
  if (rate === null) return null;

  if (rate >= 80) {
    return {
      label: "excellent",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/20",
    };
  }
  if (rate >= 50) {
    return {
      label: "good",
      color: "text-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-950/20",
    };
  }
  if (rate >= 30) {
    return {
      label: "warning",
      color: "text-amber-600",
      bgColor: "bg-amber-50 dark:bg-amber-950/20",
    };
  }
  return {
    label: "poor",
    color: "text-rose-600",
    bgColor: "bg-rose-50 dark:bg-rose-950/20",
  };
}

export function PerformanceTab({
  durationMs,
  tfftMs,
  firstByteMs,
  outputTokens,
}: PerformanceTabProps) {
  const t = useTranslations("dashboard.logs.details");

  // Normalize undefined to null for consistent handling
  const normalizedDurationMs = durationMs ?? null;
  const normalizedTfftMs = tfftMs ?? null;
  const normalizedFirstByteMs = firstByteMs ?? null;
  const normalizedOutputTokens = outputTokens ?? null;

  const outputRate = calculateOutputRate(
    normalizedOutputTokens,
    normalizedDurationMs,
    normalizedFirstByteMs
  );
  const hideRate = shouldHideOutputRate(outputRate, normalizedDurationMs, normalizedFirstByteMs);
  const generationMs =
    normalizedDurationMs !== null && normalizedTfftMs !== null
      ? normalizedDurationMs - normalizedTfftMs
      : null;

  const tfftAssessment = getTfftAssessment(normalizedTfftMs);
  const rateAssessment = getOutputRateAssessment(outputRate);

  const hasData =
    normalizedDurationMs !== null ||
    normalizedTfftMs !== null ||
    normalizedFirstByteMs !== null ||
    (outputRate !== null && !hideRate) ||
    normalizedOutputTokens !== null;

  if (!hasData) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Gauge className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{t("performanceTab.noPerformanceData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Gauges Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* TFFT Gauge */}
        {normalizedTfftMs !== null && (
          <div
            className={cn(
              "flex-1 flex items-center gap-4 p-4 rounded-lg border",
              tfftAssessment?.bgColor || "bg-muted/50"
            )}
          >
            <div className="relative">
              <CircularProgress
                value={Math.min(normalizedTfftMs, 3000)}
                max={3000}
                size={64}
                strokeWidth={5}
                showPercentage={false}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Clock
                  className={cn("h-5 w-5", tfftAssessment?.color || "text-muted-foreground")}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{t("performanceTab.tfftGauge")}</p>
              <p className="text-xl font-bold font-mono">
                {normalizedTfftMs >= 1000
                  ? `${(normalizedTfftMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedTfftMs)}ms`}
              </p>
              {tfftAssessment && (
                <Badge variant="outline" className={cn("text-[10px] mt-1", tfftAssessment.color)}>
                  {t(`performanceTab.assessment.${tfftAssessment.label}`)}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Output Rate Gauge */}
        {outputRate !== null && !hideRate && (
          <div
            className={cn(
              "flex-1 flex items-center gap-4 p-4 rounded-lg border",
              rateAssessment?.bgColor || "bg-muted/50"
            )}
          >
            <div className="relative">
              <CircularProgress
                value={Math.min(outputRate, 100)}
                max={100}
                size={64}
                strokeWidth={5}
                showPercentage={false}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Zap className={cn("h-5 w-5", rateAssessment?.color || "text-muted-foreground")} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{t("performanceTab.outputRateGauge")}</p>
              <p className="text-xl font-bold font-mono">{outputRate.toFixed(1)} tok/s</p>
              {rateAssessment && (
                <Badge variant="outline" className={cn("text-[10px] mt-1", rateAssessment.color)}>
                  {t(`performanceTab.assessment.${rateAssessment.label}`)}
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Latency Breakdown Bar */}
      {normalizedTfftMs !== null && normalizedDurationMs !== null && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-purple-600" />
            {t("performanceTab.latencyBreakdown")}
          </h4>
          <div className="p-4 rounded-lg border bg-card">
            <LatencyBreakdownBar
              firstByteMs={normalizedFirstByteMs}
              tfftMs={normalizedTfftMs}
              durationMs={normalizedDurationMs}
            />
          </div>
        </div>
      )}

      {/* Detailed Metrics Table */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t("performance.title")}</h4>
        <div className="rounded-lg border bg-card divide-y">
          {normalizedFirstByteMs !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.ttfb")}</span>
              <span className="text-sm font-mono font-medium">
                {normalizedFirstByteMs >= 1000
                  ? `${(normalizedFirstByteMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedFirstByteMs)}ms`}
              </span>
            </div>
          )}
          {normalizedTfftMs !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.tfft")}</span>
              <span className="text-sm font-mono font-medium">
                {normalizedTfftMs >= 1000
                  ? `${(normalizedTfftMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedTfftMs)}ms`}
              </span>
            </div>
          )}
          {generationMs !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">
                {t("performanceTab.generationTime")}
              </span>
              <span className="text-sm font-mono font-medium">
                {generationMs >= 1000
                  ? `${(generationMs / 1000).toFixed(2)}s`
                  : `${Math.round(generationMs)}ms`}
              </span>
            </div>
          )}
          {normalizedDurationMs !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.duration")}</span>
              <span className="text-sm font-mono font-medium">
                {normalizedDurationMs >= 1000
                  ? `${(normalizedDurationMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedDurationMs)}ms`}
              </span>
            </div>
          )}
          {normalizedOutputTokens !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.outputTokens")}</span>
              <span className="text-sm font-mono font-medium">
                {formatTokenAmount(normalizedOutputTokens)}
              </span>
            </div>
          )}
          {outputRate !== null && !hideRate && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.outputRate")}</span>
              <span className="text-sm font-mono font-medium">{outputRate.toFixed(1)} tok/s</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
