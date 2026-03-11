"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { getUserInsightsKeyTrend } from "@/actions/admin-user-insights";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { DatabaseKeyStatRow } from "@/types/statistics";
import type { TimeRangePreset } from "./filters/types";

interface UserKeyTrendChartProps {
  userId: number;
  timeRange: TimeRangePreset;
  keyId?: number;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
];

interface ChartKey {
  id: number;
  name: string;
  dataKey: string;
}

export function UserKeyTrendChart({ userId, timeRange, keyId }: UserKeyTrendChartProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");
  const tStats = useTranslations("dashboard.stats");

  const {
    data: rawData,
    isLoading,
    isError,
  } = useQuery({
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

    // Client-side filter by keyId if specified
    const filtered = keyId ? rawData.filter((row) => row.key_id === keyId) : rawData;

    // Extract unique keys
    const keyMap = new Map<number, string>();
    for (const row of filtered) {
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
    for (const row of filtered) {
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
      calls: { label: tStats("requests") },
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
  }, [rawData, timeRange, keyId, tStats]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t("keyTrend")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : isError ? (
          <div className="flex items-center justify-center h-[300px] text-destructive">
            <AlertCircle className="h-4 w-4 mr-2" />
            {t("loadError")}
          </div>
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
