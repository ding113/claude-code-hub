"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface LatencyBreakdownBarProps {
  /** Time to first byte in milliseconds */
  ttfbMs: number | null;
  /** Total duration in milliseconds */
  durationMs: number | null;
  /** Optional className */
  className?: string;
  /** Whether to show labels below the bar */
  showLabels?: boolean;
}

function formatMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

export function LatencyBreakdownBar({
  ttfbMs,
  durationMs,
  className,
  showLabels = true,
}: LatencyBreakdownBarProps) {
  const t = useTranslations("dashboard.logs.details.performanceTab");

  // Handle null/invalid values
  if (
    ttfbMs === null ||
    durationMs === null ||
    ttfbMs < 0 ||
    durationMs <= 0 ||
    ttfbMs > durationMs
  ) {
    return null;
  }

  const generationMs = durationMs - ttfbMs;
  const ttfbPercent = (ttfbMs / durationMs) * 100;
  const generationPercent = 100 - ttfbPercent;

  // Minimum width for visibility (3%)
  const minWidth = 3;
  const adjustedTtfbPercent = Math.max(ttfbPercent, ttfbMs > 0 ? minWidth : 0);
  const adjustedGenerationPercent = Math.max(generationPercent, generationMs > 0 ? minWidth : 0);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Bar container */}
      <div className="flex h-6 w-full overflow-hidden rounded-lg bg-muted/50">
        {/* TTFB segment */}
        {ttfbMs > 0 && (
          <div
            className="flex items-center justify-center bg-blue-500 text-white text-[10px] font-medium transition-all duration-300"
            style={{ width: `${adjustedTtfbPercent}%` }}
            title={`TTFB: ${formatMs(ttfbMs)} (${ttfbPercent.toFixed(1)}%)`}
          >
            {ttfbPercent >= 15 && <span>TTFB</span>}
          </div>
        )}

        {/* Generation segment */}
        {generationMs > 0 && (
          <div
            className="flex items-center justify-center bg-emerald-500 text-white text-[10px] font-medium transition-all duration-300"
            style={{ width: `${adjustedGenerationPercent}%` }}
            title={`Generation: ${formatMs(generationMs)} (${generationPercent.toFixed(1)}%)`}
          >
            {generationPercent >= 15 && <span>Generation</span>}
          </div>
        )}
      </div>

      {/* Labels */}
      {showLabels && (
        <div className="flex justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
            <span className="text-muted-foreground">TTFB:</span>
            <span className="font-mono font-medium">{formatMs(ttfbMs)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            <span className="text-muted-foreground">{t("generationTime")}:</span>
            <span className="font-mono font-medium">{formatMs(generationMs)}</span>
          </div>
        </div>
      )}

      {/* Total */}
      <div className="text-xs text-muted-foreground text-center">
        Total: <span className="font-mono font-medium">{formatMs(durationMs)}</span>
      </div>
    </div>
  );
}
