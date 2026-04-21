"use client";

import type { PublicStatusTimelineBucket } from "@/lib/public-status/payload";
import { cn } from "@/lib/utils";

interface PublicStatusTimelineProps {
  items: PublicStatusTimelineBucket[];
}

function normalizeItems(items: PublicStatusTimelineBucket[]): PublicStatusTimelineBucket[] {
  if (items.length >= 60) {
    return items.slice(-60);
  }

  const fillers = Array.from({ length: 60 - items.length }, (_, index) => ({
    bucketStart: `filler-${index}`,
    bucketEnd: `filler-${index}`,
    state: "no_data" as const,
    availabilityPct: null,
    ttfbMs: null,
    tps: null,
    sampleCount: 0,
  }));

  return [...fillers, ...items];
}

function getBucketClassName(state: PublicStatusTimelineBucket["state"]): string {
  if (state === "operational") {
    return "bg-emerald-500/80";
  }
  if (state === "failed") {
    return "bg-rose-500/80";
  }
  return "bg-muted";
}

export function PublicStatusTimeline({ items }: PublicStatusTimelineProps) {
  const normalized = normalizeItems(items);

  return (
    <div className="grid grid-cols-10 gap-1 sm:grid-cols-12 md:grid-cols-15 lg:grid-cols-20 xl:grid-cols-30">
      {normalized.map((item, index) => (
        <div
          key={`${item.bucketStart}-${index}`}
          className={cn(
            "h-3 rounded-full border border-white/10 transition-colors",
            getBucketClassName(item.state)
          )}
          title={item.bucketStart}
        />
      ))}
    </div>
  );
}
