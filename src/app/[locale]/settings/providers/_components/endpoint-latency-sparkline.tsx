"use client";

import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { getProviderEndpointProbeLogs } from "@/actions/provider-endpoints";

type SparkPoint = {
  index: number;
  latencyMs: number | null;
  ok: boolean;
};

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
        }));
    },
    staleTime: 30_000,
  });

  if (points.length === 0) {
    return <div className="h-6 w-32 rounded bg-muted/20" />;
  }

  const lastPoint = points[points.length - 1];
  const stroke = lastPoint?.ok ? "#16a34a" : "#dc2626";

  return (
    <div className="h-6 w-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[0, "dataMax + 50"]} />
          <Line
            type="monotone"
            dataKey="latencyMs"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
