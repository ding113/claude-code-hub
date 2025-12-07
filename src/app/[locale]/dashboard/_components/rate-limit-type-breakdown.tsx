"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { Cell, Legend, Pie, PieChart } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { RateLimitType } from "@/types/statistics";

export interface RateLimitTypeBreakdownProps {
  data: Record<RateLimitType, number>;
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(15, 85%, 60%)",
];

/**
 * 限流类型分布饼图
 * 显示不同限流类型的事件占比
 */
export function RateLimitTypeBreakdown({ data }: RateLimitTypeBreakdownProps) {
  const t = useTranslations("dashboard.rateLimits.breakdown");

  // 转换数据为图表格式
  const chartData = React.useMemo(() => {
    return Object.entries(data)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({
        type: type as RateLimitType,
        count,
        name: t(`types.${type}`),
      }))
      .sort((a, b) => b.count - a.count);
  }, [data, t]);

  const chartConfig: ChartConfig = React.useMemo(() => {
    const config: ChartConfig = {};
    chartData.forEach((item, index) => {
      config[item.type] = {
        label: item.name,
        color: COLORS[index % COLORS.length],
      };
    });
    return config;
  }, [chartData]);

  const totalEvents = React.useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.count, 0);
  }, [chartData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t("description")} · {t("total")}: {totalEvents.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
            {t("noData")}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[280px]">
            <PieChart>
              <ChartTooltip
                cursor={false}
                wrapperStyle={{ zIndex: 1000 }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return <div className="hidden" />;

                  const data = payload[0].payload;
                  const percentage = ((data.count / totalEvents) * 100).toFixed(1);

                  return (
                    <div className="rounded-lg border bg-background p-3 shadow-sm">
                      <div className="grid gap-2">
                        <div className="font-medium">{data.name}</div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t("count")}:</span>
                          <span className="font-mono font-bold">{data.count.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t("percentage")}:</span>
                          <span className="font-mono font-bold">{percentage}%</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${entry.type}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Legend
                verticalAlign="bottom"
                height={36}
                content={({ payload }) => (
                  <div className="flex flex-wrap justify-center gap-2 pt-4">
                    {payload?.map((entry, index) => (
                      <div
                        key={`legend-${index}`}
                        className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1"
                      >
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-xs font-medium">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
