"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface LatencyBreakdownBarProps {
  /** Time to first byte in milliseconds */
  ttfbMs: number | null;
  /** Time to first protocol-valid content in milliseconds */
  ttftMs: number | null;
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
  ttftMs,
  durationMs,
  className,
  showLabels = true,
}: LatencyBreakdownBarProps) {
  const t = useTranslations("dashboard.logs.details.performanceTab");

  // Handle null/invalid values
  if (
    ttfbMs === null ||
    ttftMs === null ||
    durationMs === null ||
    ttfbMs < 0 ||
    ttftMs < ttfbMs ||
    durationMs <= 0 ||
    ttftMs > durationMs
  ) {
    return null;
  }

  const firstByteToFirstTokenMs = ttftMs - ttfbMs;
  const generationMs = durationMs - ttftMs;
  const ttfbPercent = (ttfbMs / durationMs) * 100;
  const firstByteToFirstTokenPercent = (firstByteToFirstTokenMs / durationMs) * 100;
  const generationPercent = (generationMs / durationMs) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Bar container */}
      <div className="flex h-6 w-full overflow-hidden rounded-lg bg-muted/50">
        {/* TTFB segment */}
        {ttfbMs > 0 && (
          <div
            className="flex items-center justify-center bg-blue-500 text-white text-[10px] font-medium transition-all duration-300"
            style={{ flexGrow: ttfbMs, minWidth: "3%" }}
            title={`${t("ttfb")}: ${formatMs(ttfbMs)} (${ttfbPercent.toFixed(1)}%)`}
          >
            {ttfbPercent >= 15 && <span>TTFB</span>}
          </div>
        )}
        {firstByteToFirstTokenMs > 0 && (
          <div
            className="flex items-center justify-center bg-amber-500 text-[10px] font-medium text-white transition-all duration-300"
            style={{ flexGrow: firstByteToFirstTokenMs, minWidth: "3%" }}
            title={`${t("firstByteToFirstToken")}: ${formatMs(firstByteToFirstTokenMs)} (${firstByteToFirstTokenPercent.toFixed(1)}%)`}
          >
            {firstByteToFirstTokenPercent >= 15 && <span>{t("ttft")}</span>}
          </div>
        )}
        {/* Generation segment */}
        {generationMs > 0 && (
          <div
            className="flex items-center justify-center bg-emerald-500 text-white text-[10px] font-medium transition-all duration-300"
            style={{ flexGrow: generationMs, minWidth: "3%" }}
            title={`${t("generationAfterFirstToken")}: ${formatMs(generationMs)} (${generationPercent.toFixed(1)}%)`}
          >
            {generationPercent >= 15 && <span>{t("generationAfterFirstToken")}</span>}
          </div>
        )}
      </div>

      {/* Labels */}
      {showLabels && (
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
            <span className="text-muted-foreground">{t("ttfb")}:</span>
            <span className="font-mono font-medium">{formatMs(ttfbMs)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
            <span className="text-muted-foreground">{t("firstByteToFirstToken")}:</span>
            <span className="font-mono font-medium">{formatMs(firstByteToFirstTokenMs)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            <span className="text-muted-foreground">{t("generationAfterFirstToken")}:</span>
            <span className="font-mono font-medium">{formatMs(generationMs)}</span>
          </div>
        </div>
      )}

      {/* Total */}
      <div className="text-xs text-muted-foreground text-center">
        {t("totalDuration")}: <span className="font-mono font-medium">{formatMs(durationMs)}</span>
      </div>
    </div>
  );
}
