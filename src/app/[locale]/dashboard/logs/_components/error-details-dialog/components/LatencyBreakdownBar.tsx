"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface LatencyBreakdownBarProps {
  /** Time to first byte in milliseconds (null on rows persisted before it was recorded) */
  firstByteMs: number | null;
  /** Time to first token in milliseconds */
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
  firstByteMs,
  ttftMs,
  durationMs,
  className,
  showLabels = true,
}: LatencyBreakdownBarProps) {
  const t = useTranslations("dashboard.logs.details.performanceTab");

  // Handle null/invalid values
  if (
    ttftMs === null ||
    durationMs === null ||
    ttftMs < 0 ||
    durationMs <= 0 ||
    ttftMs > durationMs
  ) {
    return null;
  }

  // 历史行没有真 TTFB：首段退化为整个 TTFT，中间段消失
  const ttfbMs =
    firstByteMs !== null && firstByteMs >= 0 && firstByteMs <= ttftMs ? firstByteMs : ttftMs;
  const tokenWaitMs = ttftMs - ttfbMs;
  const generationMs = durationMs - ttftMs;

  const percent = (ms: number) => (ms / durationMs) * 100;
  // Minimum width for visibility (3%)
  const minWidth = 3;
  const width = (ms: number) => Math.max(percent(ms), ms > 0 ? minWidth : 0);

  const segments = [
    {
      key: "ttfb",
      ms: ttfbMs,
      label: t("segmentTtfb"),
      barClass: "bg-blue-500",
      dotClass: "bg-blue-500",
    },
    {
      key: "tokenWait",
      ms: tokenWaitMs,
      label: t("segmentTtft"),
      barClass: "bg-violet-500",
      dotClass: "bg-violet-500",
    },
    {
      key: "generation",
      ms: generationMs,
      label: t("generationTime"),
      barClass: "bg-emerald-500",
      dotClass: "bg-emerald-500",
    },
  ];

  return (
    <div className={cn("space-y-2", className)}>
      {/* Bar container */}
      <div className="flex h-6 w-full overflow-hidden rounded-lg bg-muted/50">
        {segments.map((segment) =>
          segment.ms > 0 ? (
            <div
              key={segment.key}
              className={cn(
                "flex items-center justify-center text-white text-[10px] font-medium transition-all duration-300",
                segment.barClass
              )}
              style={{ width: `${width(segment.ms)}%` }}
              title={`${segment.label}: ${formatMs(segment.ms)} (${percent(segment.ms).toFixed(1)}%)`}
            >
              {percent(segment.ms) >= 15 && <span>{segment.label}</span>}
            </div>
          ) : null
        )}
      </div>

      {/* Labels */}
      {showLabels && (
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
          {segments.map((segment) =>
            segment.ms > 0 ? (
              <div key={segment.key} className="flex items-center gap-1.5">
                <div className={cn("h-2.5 w-2.5 rounded-sm", segment.dotClass)} />
                <span className="text-muted-foreground">{segment.label}:</span>
                <span className="font-mono font-medium">{formatMs(segment.ms)}</span>
              </div>
            ) : null
          )}
        </div>
      )}

      {/* Total */}
      <div className="text-xs text-muted-foreground text-center">
        {t("segmentTotal")}: <span className="font-mono font-medium">{formatMs(durationMs)}</span>
      </div>
    </div>
  );
}
