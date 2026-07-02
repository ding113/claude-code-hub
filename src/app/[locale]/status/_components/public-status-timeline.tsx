"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { FilledTimelineCell } from "../_lib/fill-display-timeline";
import { formatTtfb } from "../_lib/format-ttfb";

export interface PublicStatusTimelineLabels {
  availability: string;
  ttfb: string;
  tps: string;
  noData: string;
  historyAriaLabel: string;
}

interface PublicStatusTimelineProps {
  cells: FilledTimelineCell[];
  timeZone: string;
  locale: string;
  labels: PublicStatusTimelineLabels;
}

function cellColor(cell: FilledTimelineCell): string {
  const { displayState, inferred, bucket } = cell;
  if (displayState === "no_data") {
    return "bg-muted/40";
  }
  if (displayState === "failed" || bucket.state === "failed") {
    return inferred ? "bg-rose-500/60" : "bg-rose-500";
  }
  const pct = bucket.availabilityPct;
  if (pct === null) {
    return displayState === "degraded"
      ? inferred
        ? "bg-amber-500/60"
        : "bg-amber-500"
      : inferred
        ? "bg-emerald-500/60"
        : "bg-emerald-500";
  }
  if (pct >= 90) return inferred ? "bg-emerald-500/60" : "bg-emerald-500";
  if (pct >= 80) return inferred ? "bg-amber-400/60" : "bg-amber-400";
  if (pct >= 60) return inferred ? "bg-orange-500/60" : "bg-orange-500";
  return inferred ? "bg-rose-500/60" : "bg-rose-500";
}

function formatRange(
  start: string,
  end: string,
  timeFormatter: Intl.DateTimeFormat,
  dateFormatter: Intl.DateTimeFormat
): string {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return `${start} – ${end}`;
    }
    return `${dateFormatter.format(startDate)} ${timeFormatter.format(startDate)} – ${timeFormatter.format(endDate)}`;
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeCell = activeIndex === null ? null : (cells[activeIndex] ?? null);
  const activeBucket = activeCell?.bucket ?? null;
  const activeIsPlaceholder = activeBucket?.bucketStart.startsWith("empty-") ?? false;
  const rangeTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
        hour12: false,
      }),
    [locale, timeZone]
  );
  const rangeDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "2-digit",
        timeZone,
      }),
    [locale, timeZone]
  );
  const activeSummary = useMemo(() => {
    if (!activeBucket) {
      return null;
    }

    return {
      range: activeIsPlaceholder
        ? null
        : formatRange(
            activeBucket.bucketStart,
            activeBucket.bucketEnd,
            rangeTimeFormatter,
            rangeDateFormatter
          ),
      availability:
        activeBucket.availabilityPct === null ? "—" : `${activeBucket.availabilityPct.toFixed(2)}%`,
      ttfb: formatTtfb(activeBucket.ttfbMs),
      tps: activeBucket.tps === null ? "—" : activeBucket.tps.toFixed(1),
    };
  }, [activeBucket, activeIsPlaceholder, rangeDateFormatter, rangeTimeFormatter]);

  return (
    <div
      className="space-y-2"
      onMouseLeave={() => setActiveIndex(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActiveIndex(null);
        }
      }}
    >
      <ul
        className="m-0 flex w-full list-none items-center gap-[2px] p-0"
        aria-label={labels.historyAriaLabel}
      >
        {cells.map((cell, index) => {
          const { bucket } = cell;
          return (
            <li key={bucket.bucketStart} className="flex-1">
              <button
                type="button"
                aria-label={`${labels.availability}: ${bucket.availabilityPct ?? "—"}`}
                className={cn(
                  "h-6 w-full rounded-[2px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring",
                  cellColor(cell)
                )}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
              />
            </li>
          );
        })}
      </ul>
      {activeSummary ? (
        <div className="rounded-md border border-border/50 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
          {activeSummary.range ? (
            <p className="mb-1 font-medium tabular-nums">{activeSummary.range}</p>
          ) : null}
          <div className="grid grid-cols-3 gap-2 font-mono">
            <span>
              <span className="text-muted-foreground">{labels.availability}</span>{" "}
              {activeSummary.availability}
            </span>
            <span>
              <span className="text-muted-foreground">{labels.ttfb}</span> {activeSummary.ttfb}
            </span>
            <span>
              <span className="text-muted-foreground">{labels.tps}</span> {activeSummary.tps}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
