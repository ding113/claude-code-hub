"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FilledTimelineCell } from "../_lib/fill-display-timeline";

export interface PublicStatusTimelineLabels {
  availability: string;
  ttfb: string;
  tps: string;
  samples: string;
  inferredFromNeighbors: string;
  noData: string;
}

interface PublicStatusTimelineProps {
  cells: FilledTimelineCell[];
  timeZone: string;
  locale: string;
  labels: PublicStatusTimelineLabels;
}

function cellColor(state: FilledTimelineCell["displayState"], inferred: boolean): string {
  switch (state) {
    case "operational":
      return inferred ? "bg-emerald-500/60" : "bg-emerald-500";
    case "degraded":
      return inferred ? "bg-amber-500/60" : "bg-amber-500";
    case "failed":
      return inferred ? "bg-rose-500/60" : "bg-rose-500";
    default:
      return "bg-muted/40";
  }
}

function formatRange(start: string, end: string, locale: string, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      hour12: false,
    });
    const dateFmt = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "2-digit",
      timeZone,
    });
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime())) return start;
    return `${dateFmt.format(startDate)} ${fmt.format(startDate)} – ${fmt.format(endDate)}`;
  } catch {
    return `${start} – ${end}`;
  }
}

export function PublicStatusTimeline({
  cells,
  timeZone,
  locale,
  labels,
}: PublicStatusTimelineProps) {
  return (
    <TooltipProvider delayDuration={80}>
      <div className="flex w-full items-center gap-[2px]" role="list" aria-label="status history">
        {cells.map((cell, index) => {
          const { bucket, displayState, inferred } = cell;
          const isPlaceholder = bucket.bucketStart.startsWith("empty-");
          return (
            <Tooltip key={`${bucket.bucketStart}-${index}`}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="listitem"
                  aria-label={`${labels.availability}: ${bucket.availabilityPct ?? "—"}`}
                  className={cn(
                    "h-6 flex-1 rounded-[2px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring",
                    cellColor(displayState, inferred)
                  )}
                />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-xs space-y-1 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md"
              >
                {!isPlaceholder ? (
                  <p className="font-medium tabular-nums">
                    {formatRange(bucket.bucketStart, bucket.bucketEnd, locale, timeZone)}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                  <span className="text-muted-foreground">{labels.availability}</span>
                  <span className="text-right">
                    {bucket.availabilityPct === null
                      ? "—"
                      : `${bucket.availabilityPct.toFixed(2)}%`}
                  </span>
                  <span className="text-muted-foreground">{labels.ttfb}</span>
                  <span className="text-right">
                    {bucket.ttfbMs === null ? "—" : `${bucket.ttfbMs} ms`}
                  </span>
                  <span className="text-muted-foreground">{labels.tps}</span>
                  <span className="text-right">
                    {bucket.tps === null ? "—" : bucket.tps.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground">{labels.samples}</span>
                  <span className="text-right">{bucket.sampleCount}</span>
                </div>
                {bucket.sampleCount === 0 && !isPlaceholder ? (
                  <p className="text-[10px] text-muted-foreground">
                    {labels.inferredFromNeighbors}
                  </p>
                ) : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
