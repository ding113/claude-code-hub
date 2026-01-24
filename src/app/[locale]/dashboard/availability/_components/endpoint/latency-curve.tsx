"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { ProviderEndpointProbeLog } from "@/types/provider";

interface LatencyCurveProps {
  logs: ProviderEndpointProbeLog[];
  className?: string;
}

const chartConfig = {
  latency: {
    label: "Latency",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function LatencyCurve({ logs, className }: LatencyCurveProps) {
  const t = useTranslations("dashboard.availability.latencyCurve");

  // Transform logs to chart data
  const chartData = useMemo(() => {
    return logs
      .filter((log) => log.latencyMs !== null)
      .map((log) => ({
        time: log.createdAt,
        timestamp: new Date(log.createdAt).getTime(),
        latency: log.latencyMs,
        ok: log.ok,
        statusCode: log.statusCode,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [logs]);

  if (chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-[200px] text-muted-foreground",
          className
        )}
      >
        {t("noData")}
      </div>
    );
  }

  const formatTime = (time: string) => {
    const date = new Date(time);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatLatency = (value: number) => {
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(1)}s`;
  };

  // Calculate stats
  const latencies = chartData.map((d) => d.latency).filter((l): l is number => l !== null);
  const avgLatency =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{t("title")}</h3>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            {t("avg")}:{" "}
            <span className="font-mono text-foreground">{formatLatency(avgLatency)}</span>
          </span>
          <span>
            {t("min")}:{" "}
            <span className="font-mono text-emerald-500">{formatLatency(minLatency)}</span>
          </span>
          <span>
            {t("max")}: <span className="font-mono text-rose-500">{formatLatency(maxLatency)}</span>
          </span>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-latency)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-latency)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/30" />
          <XAxis
            dataKey="time"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={formatTime}
            className="text-xs text-muted-foreground"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={formatLatency}
            className="text-xs text-muted-foreground"
            width={50}
          />
          <ChartTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload;
              return (
                <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                  <div className="font-medium mb-1">{formatTime(label as string)}</div>
                  <div className="space-y-1">
                    <div>{formatLatency(payload[0]?.value as number)}</div>
                    <div className={cn("text-xs", data?.ok ? "text-emerald-500" : "text-rose-500")}>
                      {data?.statusCode || (data?.ok ? "OK" : "FAIL")}
                    </div>
                  </div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="latency"
            stroke="var(--color-latency)"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              if (!payload.ok) {
                return (
                  <circle
                    key={`dot-${payload.timestamp}`}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="var(--destructive)"
                    stroke="var(--destructive)"
                  />
                );
              }
              return null;
            }}
            activeDot={{
              r: 6,
              fill: "var(--color-latency)",
              stroke: "var(--background)",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
