"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { getUserInsightsKeyTrend } from "@/actions/admin-user-insights";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { DatabaseKeyStatRow } from "@/types/statistics";

interface UserKeyTrendChartProps {
  userId: number;
}

type TimeRangeKey = "today" | "7days" | "30days" | "thisMonth";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
];

interface ChartKey {
  id: number;
  name: string;
  dataKey: string;
}

export function UserKeyTrendChart({ userId }: UserKeyTrendChartProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("7days");

  const { data: rawData, isLoading } = useQuery({
    queryKey: ["user-insights-key-trend", userId, timeRange],
    queryFn: async () => {
      const result = await getUserInsightsKeyTrend(userId, timeRange);
      if (!result.ok) throw new Error(result.error);
      return result.data as DatabaseKeyStatRow[];
    },
  });

  const { chartData, keys, chartConfig } = useMemo(() => {
    if (!rawData || rawData.length === 0) {
      return { chartData: [], keys: [] as ChartKey[], chartConfig: {} as ChartConfig };
    }

    // Extract unique keys
    const keyMap = new Map<number, string>();
    for (const row of rawData) {
      if (!keyMap.has(row.key_id)) {
        keyMap.set(row.key_id, row.key_name);
      }
    }

    const uniqueKeys: ChartKey[] = Array.from(keyMap.entries()).map(([id, name]) => ({
      id,
      name,
      dataKey: `key-${id}`,
    }));

    // Build chart data grouped by date
    const dataByDate = new Map<string, Record<string, string | number>>();
    for (const row of rawData) {
      const dateStr =
        timeRange === "today" ? new Date(row.date).toISOString() : row.date.split("T")[0];

      if (!dataByDate.has(dateStr)) {
        dataByDate.set(dateStr, { date: dateStr });
      }
      const entry = dataByDate.get(dateStr)!;
      const dk = `key-${row.key_id}`;
      entry[`${dk}_calls`] = row.api_calls || 0;
      const cost = row.total_cost;
      entry[`${dk}_cost`] =
        typeof cost === "number" ? cost : cost != null ? Number.parseFloat(cost) || 0 : 0;
    }

    // Build chart config
    const config: ChartConfig = {
      calls: { label: "Calls" },
    };
    for (let i = 0; i < uniqueKeys.length; i++) {
      const key = uniqueKeys[i];
      config[key.dataKey] = {
        label: key.name,
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    }

    return {
      chartData: Array.from(dataByDate.values()).sort((a, b) =>
        (a.date as string).localeCompare(b.date as string)
      ),
      keys: uniqueKeys,
      chartConfig: config,
    };
  }, [rawData, timeRange]);

  const timeRangeOptions: { key: TimeRangeKey; labelKey: string }[] = [
    { key: "today", labelKey: "timeRange.today" },
    { key: "7days", labelKey: "timeRange.7days" },
    { key: "30days", labelKey: "timeRange.30days" },
    { key: "thisMonth", labelKey: "timeRange.thisMonth" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <CardTitle className="text-base font-semibold">{t("keyTrend")}</CardTitle>
        <div className="flex gap-1">
          {timeRangeOptions.map((opt) => (
            <Button
              key={opt.key}
              variant={timeRange === opt.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setTimeRange(opt.key)}
              data-testid={`user-insights-time-range-${opt.key}`}
            >
              {t(opt.labelKey)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            {t("noData")}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
            <AreaChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <defs>
                {keys.map((key, index) => {
                  const color = CHART_COLORS[index % CHART_COLORS.length];
                  return (
                    <linearGradient
                      key={key.dataKey}
                      id={`fill-trend-${key.dataKey}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.1} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: string) => {
                  if (timeRange === "today") {
                    const d = new Date(value);
                    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                  }
                  const parts = value.split("-");
                  return `${parts[1]}/${parts[2]}`;
                }}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
              <ChartTooltip />
              {keys.map((key, index) => {
                const color = CHART_COLORS[index % CHART_COLORS.length];
                return (
                  <Area
                    key={key.dataKey}
                    dataKey={`${key.dataKey}_calls`}
                    name={key.name}
                    type="monotone"
                    fill={`url(#fill-trend-${key.dataKey})`}
                    stroke={color}
                    strokeWidth={2}
                  />
                );
              })}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
