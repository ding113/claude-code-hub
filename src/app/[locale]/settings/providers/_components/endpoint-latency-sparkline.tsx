"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { useInViewOnce } from "@/lib/hooks/use-in-view-once";
import { type ProbeLog, probeLogsBatcher } from "@/lib/provider-endpoints/probe-logs-batcher";
import { cn } from "@/lib/utils";

type SparkPoint = {
  index: number;
  latencyMs: number | null;
  ok: boolean;
  timestamp?: number;
};

function formatLatency(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SparkPoint }>;
}) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md bg-popover/95 backdrop-blur-sm border border-border px-2 py-1 shadow-md">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("h-2 w-2 rounded-full", point.ok ? "bg-emerald-500" : "bg-red-500")} />
        <span className="font-mono font-medium">{formatLatency(point.latencyMs)}</span>
      </div>
    </div>
  );
}

function probeLogsToSparkPoints(logs: ProbeLog[]): SparkPoint[] {
  const points: SparkPoint[] = new Array(logs.length);
  for (let i = logs.length - 1, idx = 0; i >= 0; i -= 1, idx += 1) {
    const log = logs[i];
    const rawTimestamp =
      log.createdAt === undefined || log.createdAt === null
        ? undefined
        : new Date(log.createdAt).getTime();
    const timestamp =
      rawTimestamp !== undefined && Number.isFinite(rawTimestamp) ? rawTimestamp : undefined;

    points[idx] = {
      index: idx,
      latencyMs: log.latencyMs ?? null,
      ok: log.ok,
      timestamp,
    };
  }
  return points;
}

export function EndpointLatencySparkline(props: { endpointId: number; limit?: number }) {
  const limit = props.limit ?? 12;
  const { ref, isInView } = useInViewOnce<HTMLDivElement>();

  const { data: points = [], isLoading } = useQuery({
    queryKey: ["endpoint-probe-logs", props.endpointId, limit],
    queryFn: async ({ signal }): Promise<SparkPoint[]> => {
      const logs = await probeLogsBatcher.load(props.endpointId, limit, { signal });
      return probeLogsToSparkPoints(logs);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: isInView,
  });

  const avgLatency = useMemo(() => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    let sum = 0;
    let count = 0;

    for (const point of points) {
      if (point.latencyMs === null) continue;
      const timestamp = point.timestamp;
      if (timestamp === undefined || timestamp < fiveMinutesAgo) continue;
      sum += point.latencyMs;
      count += 1;
    }

    return count > 0 ? sum / count : null;
  }, [points]);

  const showSkeleton = !isInView || isLoading;

  if (showSkeleton) {
    return (
      <div ref={ref} className="flex items-center gap-2">
        <div className="h-6 w-32 rounded bg-muted/20" />
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div ref={ref} className="flex items-center gap-2">
        <div className="h-6 w-32 rounded bg-muted/10" />
      </div>
    );
  }

  const lastPoint = points[points.length - 1];
  const stroke = lastPoint?.ok ? "#16a34a" : "#dc2626";

  return (
    <div ref={ref} className="flex items-center gap-2">
      <div className="h-6 w-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide domain={[0, "dataMax + 50"]} />
            <Tooltip content={<CustomTooltip />} cursor={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="latencyMs"
              stroke={stroke}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: stroke }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {avgLatency !== null && (
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          {formatLatency(avgLatency)}
        </span>
      )}
    </div>
  );
}
