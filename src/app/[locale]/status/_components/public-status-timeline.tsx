"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { PublicStatusTimelineBucket } from "@/lib/public-status/aggregation";
import { cn } from "@/lib/utils";

interface PublicStatusTimelineProps {
  items: PublicStatusTimelineBucket[];
  nextRefreshInMs?: number | null;
  labels: {
    history: string;
    noData: string;
    generatedAt: string;
    ttfb: string;
    tps: string;
    operational: string;
    failed: string;
    past: string;
    now: string;
  };
}

const SEGMENT_LIMIT = 60;

function formatRemainingTime(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function compressTimeline(items: PublicStatusTimelineBucket[]): PublicStatusTimelineBucket[] {
  if (items.length <= SEGMENT_LIMIT) {
    return items;
  }

  const chunkSize = Math.ceil(items.length / SEGMENT_LIMIT);
  const result: PublicStatusTimelineBucket[] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const last = chunk.at(-1);
    if (!last) continue;

    const sampleCount = chunk.reduce((sum, item) => sum + item.sampleCount, 0);
    const state = [...chunk].reverse().find((item) => item.state !== "no_data")?.state ?? "no_data";

    result.push({
      ...last,
      state,
      sampleCount,
      availabilityPct:
        sampleCount === 0
          ? state === "operational"
            ? 100
            : state === "failed"
              ? 0
              : null
          : last.availabilityPct,
    });
  }

  return result;
}

function getBucketColor(state: PublicStatusTimelineBucket["state"]) {
  if (state === "operational") return "bg-green-500";
  if (state === "failed") return "bg-red-500";
  return "bg-muted/10";
}

export function PublicStatusTimeline({
  items,
  nextRefreshInMs,
  labels,
}: PublicStatusTimelineProps) {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [activeSegmentKey, setActiveSegmentKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => {
      const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
      const nextIsCoarse = media.matches || hasTouch;
      setIsCoarsePointer((prev) => {
        if (prev && !nextIsCoarse) {
          setActiveSegmentKey(null);
        }
        return nextIsCoarse;
      });
    };

    updatePointerType();
    media.addEventListener("change", updatePointerType);
    return () => media.removeEventListener("change", updatePointerType);
  }, []);

  const segments = compressTimeline(items);
  const padded = Array.from({ length: SEGMENT_LIMIT }, (_, index) => segments[index] ?? null);
  const nextRefreshLabel =
    typeof nextRefreshInMs === "number" ? formatRemainingTime(nextRefreshInMs) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{labels.history}</span>
        <div className="flex items-center gap-2">
          {nextRefreshLabel ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Clock className="h-3 w-3" />
              {labels.generatedAt} {nextRefreshLabel}
            </span>
          ) : (
            <span className="opacity-50">{labels.noData}</span>
          )}
        </div>
      </div>

      <div className="relative h-8 w-full overflow-hidden rounded-sm bg-muted/20">
        <div className="flex h-full w-full flex-row-reverse gap-[2px] p-[2px]">
          {padded.map((segment, index) => {
            if (!segment) {
              return (
                <div key={`placeholder-${index}`} className="flex-1 rounded-[1px] bg-muted/10" />
              );
            }

            const segmentKey = `${segment.bucketStart}-${index}`;
            const isOpen = activeSegmentKey === segmentKey;

            return (
              <HoverCard
                key={segmentKey}
                open={isOpen}
                openDelay={isCoarsePointer ? 0 : 100}
                onOpenChange={(nextOpen) =>
                  setActiveSegmentKey((current) =>
                    nextOpen ? segmentKey : current === segmentKey ? null : current
                  )
                }
              >
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "relative block h-full w-full flex-1 rounded-[1px] transition-all duration-200",
                      getBucketColor(segment.state),
                      "hover:opacity-80 hover:scale-y-110",
                      isOpen && "ring-1 ring-foreground/20 scale-y-110 z-10"
                    )}
                    onClick={() =>
                      setActiveSegmentKey((current) => (current === segmentKey ? null : segmentKey))
                    }
                  />
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  className="w-64 space-y-3 rounded-xl border-border/50 bg-background/95 p-4 shadow-xl backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <Badge
                      variant={
                        segment.state === "operational"
                          ? "default"
                          : segment.state === "failed"
                            ? "destructive"
                            : "outline"
                      }
                      className="h-5 px-1.5 text-[10px]"
                    >
                      {segment.state === "operational"
                        ? labels.operational
                        : segment.state === "failed"
                          ? labels.failed
                          : labels.noData}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(segment.bucketStart).toLocaleString()}
                    </span>
                  </div>

                  <div className="grid gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{labels.ttfb}</span>
                      <span className="font-mono font-medium">
                        {segment.ttfbMs === null ? "—" : `${segment.ttfbMs} ms`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{labels.tps}</span>
                      <span className="font-mono font-medium">
                        {segment.tps === null ? "—" : segment.tps.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between text-[9px] font-medium uppercase tracking-widest text-muted-foreground/50">
        <span>{labels.past}</span>
        <span>{labels.now}</span>
      </div>
    </div>
  );
}
