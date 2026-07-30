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
 * Get TTFB performance assessment
 * Thresholds: <1s excellent, <2s good, <3s warning, >=3s poor
 */
function getTtfbAssessment(ttfbMs: number | null): {
  label: string;
  color: string;
  bgColor: string;
} | null {
  if (ttfbMs === null) return null;

  if (ttfbMs < 1000) {
    return {
      label: "excellent",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/20",
    };
  }
  if (ttfbMs < 2000) {
    return {
      label: "good",
      color: "text-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-950/20",
    };
  }
  if (ttfbMs < 3000) {
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
  ttfbMs,
  ttftMs,
  timingSemanticsVersion,
  outputTokens,
}: PerformanceTabProps) {
  const t = useTranslations("dashboard.logs.details");

  const hasCurrentTimingSemantics = timingSemanticsVersion === 2;
  const normalizedDurationMs = durationMs ?? null;
  const normalizedTtfbMs = hasCurrentTimingSemantics ? (ttfbMs ?? null) : null;
  const normalizedTtftMs = hasCurrentTimingSemantics ? (ttftMs ?? null) : null;
  const normalizedOutputTokens = outputTokens ?? null;

  const outputRate = calculateOutputRate(
    normalizedOutputTokens,
    normalizedDurationMs,
    normalizedTtftMs
  );
  const hideRate = shouldHideOutputRate(outputRate, normalizedDurationMs, normalizedTtftMs);
  const generationMs =
    normalizedDurationMs !== null && normalizedTtftMs !== null
      ? normalizedDurationMs - normalizedTtftMs
      : null;
  const ttfbAssessment = getTtfbAssessment(normalizedTtfbMs);
  const ttftAssessment = getTtfbAssessment(normalizedTtftMs);
  const rateAssessment = getOutputRateAssessment(outputRate);

  const hasData =
    normalizedDurationMs !== null ||
    normalizedTtfbMs !== null ||
    normalizedTtftMs !== null ||
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
      {!hasCurrentTimingSemantics && (ttfbMs != null || ttftMs != null) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t("performance.timingUnavailable")}
        </div>
      )}

      {/* Gauges Row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* TTFB Gauge */}
        {normalizedTtfbMs !== null && (
          <div
            className={cn(
              "flex-1 flex items-center gap-4 p-4 rounded-lg border",
              ttfbAssessment?.bgColor || "bg-muted/50"
            )}
          >
            <div className="relative">
              <CircularProgress
                value={Math.min(normalizedTtfbMs, 3000)}
                max={3000}
                size={64}
                strokeWidth={5}
                showPercentage={false}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Clock
                  className={cn("h-5 w-5", ttfbAssessment?.color || "text-muted-foreground")}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{t("performanceTab.ttfbGauge")}</p>
              <p className="text-xl font-bold font-mono">
                {normalizedTtfbMs >= 1000
                  ? `${(normalizedTtfbMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedTtfbMs)}ms`}
              </p>
              {ttfbAssessment && (
                <Badge variant="outline" className={cn("text-[10px] mt-1", ttfbAssessment.color)}>
                  {t(`performanceTab.assessment.${ttfbAssessment.label}`)}
                </Badge>
              )}
            </div>
          </div>
        )}

        {normalizedTtftMs !== null && (
          <div
            className={cn(
              "flex items-center gap-4 rounded-lg border p-4",
              ttftAssessment?.bgColor || "bg-muted/50"
            )}
          >
            <div className="relative">
              <CircularProgress
                value={Math.min(normalizedTtftMs, 3000)}
                max={3000}
                size={64}
                strokeWidth={5}
                showPercentage={false}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Gauge
                  className={cn("h-5 w-5", ttftAssessment?.color || "text-muted-foreground")}
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t("performanceTab.ttftGauge")}</p>
              <p className="font-mono text-xl font-bold">
                {normalizedTtftMs >= 1000
                  ? `${(normalizedTtftMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedTtftMs)}ms`}
              </p>
              {ttftAssessment && (
                <Badge variant="outline" className={cn("mt-1 text-[10px]", ttftAssessment.color)}>
                  {t(`performanceTab.assessment.${ttftAssessment.label}`)}
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
      {normalizedTtfbMs !== null && normalizedTtftMs !== null && normalizedDurationMs !== null && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-purple-600" />
            {t("performanceTab.latencyBreakdown")}
          </h4>
          <div className="p-4 rounded-lg border bg-card">
            <LatencyBreakdownBar
              ttfbMs={normalizedTtfbMs}
              ttftMs={normalizedTtftMs}
              durationMs={normalizedDurationMs}
            />
          </div>
        </div>
      )}

      {/* Detailed Metrics Table */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t("performance.title")}</h4>
        <div className="rounded-lg border bg-card divide-y">
          {normalizedTtfbMs !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.ttfb")}</span>
              <span className="text-sm font-mono font-medium">
                {normalizedTtfbMs >= 1000
                  ? `${(normalizedTtfbMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedTtfbMs)}ms`}
              </span>
            </div>
          )}
          {normalizedTtftMs !== null && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">{t("performance.ttft")}</span>
              <span className="font-mono text-sm font-medium">
                {normalizedTtftMs >= 1000
                  ? `${(normalizedTtftMs / 1000).toFixed(2)}s`
                  : `${Math.round(normalizedTtftMs)}ms`}
              </span>
            </div>
          )}
          {generationMs !== null && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">
                {t("performanceTab.generationAfterFirstToken")}
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
