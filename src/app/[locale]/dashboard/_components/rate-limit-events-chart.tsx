"use client";

import { formatInTimeZone } from "date-fns-tz";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { getDateFnsLocale } from "@/lib/utils/date-format";
import type { EventTimeline } from "@/types/statistics";

export interface RateLimitEventsChartProps {
  data: EventTimeline[];
}

/**
 * 限流事件时间线图表
 * 使用 Recharts AreaChart 显示小时级别的限流事件趋势
 */
export function RateLimitEventsChart({ data }: RateLimitEventsChartProps) {
  const t = useTranslations("dashboard.rateLimits.chart");
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  const dateFnsLocale = getDateFnsLocale(locale);

  const chartConfig = React.useMemo(
    () =>
      ({
        count: {
          label: t("events"),
          color: "hsl(var(--chart-1))",
        },
      }) satisfies ChartConfig,
    [t]
  );

  // Format hour display with timezone
  const formatHour = (hourStr: string) => {
    const date = new Date(hourStr);
    return formatInTimeZone(date, timeZone, "M/d HH:mm", { locale: dateFnsLocale });
  };

  // Format tooltip display with timezone
  const formatTooltipHour = (hourStr: string) => {
    const date = new Date(hourStr);
    return formatInTimeZone(date, timeZone, "yyyy MMMM d HH:mm", { locale: dateFnsLocale });
  };

  // 计算总事件数
  const totalEvents = React.useMemo(() => {
    return data.reduce((sum, item) => sum + item.count, 0);
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t("description")} · {t("total")}: {totalEvents.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          <AreaChart
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <defs>
              <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="hour"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatHour}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value.toLocaleString()}
            />
            <ChartTooltip
              cursor={false}
              wrapperStyle={{ zIndex: 1000 }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return <div className="hidden" />;

                const data = payload[0].payload as EventTimeline;

                return (
                  <div className="rounded-lg border bg-background p-3 shadow-sm">
                    <div className="grid gap-2">
                      <div className="font-medium text-center">{formatTooltipHour(data.hour)}</div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: "var(--color-count)" }}
                          />
                          <span className="font-medium">{t("events")}:</span>
                        </div>
                        <span className="ml-auto font-mono">{data.count.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              dataKey="count"
              type="monotone"
              fill="url(#fillCount)"
              stroke="var(--color-count)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
