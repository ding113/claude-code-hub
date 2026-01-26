"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { getProviderEndpointProbeLogs } from "@/actions/provider-endpoints";
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

export function EndpointLatencySparkline(props: { endpointId: number; limit?: number }) {
  const { data: points = [] } = useQuery({
    queryKey: ["endpoint-probe-logs", props.endpointId, props.limit ?? 12],
    queryFn: async (): Promise<SparkPoint[]> => {
      const res = await getProviderEndpointProbeLogs({
        endpointId: props.endpointId,
        limit: props.limit ?? 12,
      });

      if (!res.ok || !res.data) {
        return [];
      }

      return res.data.logs
        .slice()
        .reverse()
        .map((log, idx) => ({
          index: idx,
          latencyMs: log.latencyMs ?? null,
          ok: log.ok,
          timestamp: log.createdAt ? new Date(log.createdAt).getTime() : undefined,
        }));
    },
    staleTime: 30_000,
  });

  const avgLatency = useMemo(() => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentPoints = points.filter(
      (p) => p.latencyMs !== null && p.timestamp && p.timestamp >= fiveMinutesAgo
    );
    if (recentPoints.length === 0) return null;
    const sum = recentPoints.reduce((acc, p) => acc + (p.latencyMs ?? 0), 0);
    return sum / recentPoints.length;
  }, [points]);

  if (points.length === 0) {
    return <div className="h-6 w-32 rounded bg-muted/20" />;
  }

  const lastPoint = points[points.length - 1];
  const stroke = lastPoint?.ok ? "#16a34a" : "#dc2626";

  return (
    <div className="flex items-center gap-2">
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
