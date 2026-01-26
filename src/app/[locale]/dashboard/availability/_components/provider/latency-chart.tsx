"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ProviderAvailabilitySummary } from "@/lib/availability";
import { cn } from "@/lib/utils";

interface LatencyChartProps {
  providers: ProviderAvailabilitySummary[];
  className?: string;
}

const chartConfig = {
  p50: {
    label: "P50",
    color: "var(--chart-2)",
  },
  p95: {
    label: "P95",
    color: "var(--chart-4)",
  },
  p99: {
    label: "P99",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function LatencyChart({ providers, className }: LatencyChartProps) {
  const t = useTranslations("dashboard.availability.latencyChart");

  // Aggregate latency data across all providers
  const chartData = useMemo(() => {
    // Collect all unique bucket times
    const bucketMap = new Map<string, { p50: number[]; p95: number[]; p99: number[] }>();

    for (const provider of providers) {
      for (const bucket of provider.timeBuckets) {
        if (bucket.totalRequests === 0) continue;

        const existing = bucketMap.get(bucket.bucketStart) || {
          p50: [],
          p95: [],
          p99: [],
        };

        existing.p50.push(bucket.p50LatencyMs);
        existing.p95.push(bucket.p95LatencyMs);
        existing.p99.push(bucket.p99LatencyMs);

        bucketMap.set(bucket.bucketStart, existing);
      }
    }

    // Calculate averages and format for chart
    return Array.from(bucketMap.entries())
      .map(([time, values]) => ({
        time,
        timestamp: new Date(time).getTime(),
        p50: values.p50.length > 0 ? values.p50.reduce((a, b) => a + b, 0) / values.p50.length : 0,
        p95: values.p95.length > 0 ? values.p95.reduce((a, b) => a + b, 0) / values.p95.length : 0,
        p99: values.p99.length > 0 ? values.p99.reduce((a, b) => a + b, 0) / values.p99.length : 0,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [providers]);

  if (chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-[300px] text-muted-foreground",
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
    });
  };

  const formatLatency = (value: number) => {
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(1)}s`;
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{t("title")}</h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "var(--chart-2)" }} />
            <span className="text-muted-foreground">{t("p50")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "var(--chart-4)" }} />
            <span className="text-muted-foreground">{t("p95")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "var(--chart-1)" }} />
            <span className="text-muted-foreground">{t("p99")}</span>
          </div>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="h-[250px] w-full">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fillP50" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-p50)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-p50)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillP95" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-p95)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-p95)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillP99" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-p99)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-p99)" stopOpacity={0} />
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
              return (
                <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                  <div className="font-medium mb-1">{formatTime(label as string)}</div>
                  <div className="space-y-1">
                    {payload.map((item) => (
                      <div key={item.dataKey} className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-muted-foreground">
                          {chartConfig[item.dataKey as keyof typeof chartConfig]?.label ||
                            item.dataKey}
                          :
                        </span>
                        <span className="font-mono">{formatLatency(item.value as number)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="p50"
            stroke="var(--color-p50)"
            fill="url(#fillP50)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="p95"
            stroke="var(--color-p95)"
            fill="url(#fillP95)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="p99"
            stroke="var(--color-p99)"
            fill="url(#fillP99)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
