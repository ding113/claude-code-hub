"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { CurrencyCode } from "@/lib/utils";
import { cn, Decimal, formatCurrency, toDecimal } from "@/lib/utils";
import type { TimeRange, UserStatisticsData } from "@/types/statistics";
import { TIME_RANGE_OPTIONS } from "@/types/statistics";
import { BentoCard } from "./bento-grid";

const USER_COLOR_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "hsl(15, 85%, 60%)",
  "hsl(195, 85%, 60%)",
  "hsl(285, 85%, 60%)",
  "hsl(135, 85%, 50%)",
  "hsl(45, 85%, 55%)",
] as const;

const getUserColor = (index: number) => USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length];

export interface StatisticsChartCardProps {
  data: UserStatisticsData;
  onTimeRangeChange?: (timeRange: TimeRange) => void;
  currencyCode?: CurrencyCode;
  colSpan?: 3 | 4;
  className?: string;
}

export function StatisticsChartCard({
  data,
  onTimeRangeChange,
  currencyCode = "USD",
  colSpan = 4,
  className,
}: StatisticsChartCardProps) {
  const t = useTranslations("dashboard.statistics");
  const locale = useLocale();
  const [activeChart, setActiveChart] = React.useState<"cost" | "calls">("cost");
  const [chartMode, setChartMode] = React.useState<"stacked" | "overlay">("overlay");

  const [selectedUserIds, setSelectedUserIds] = React.useState<Set<number>>(
    () => new Set(data.users.map((u) => u.id))
  );

  React.useEffect(() => {
    setSelectedUserIds(new Set(data.users.map((u) => u.id)));
  }, [data.users]);

  const isAdminMode = data.mode === "users";
  const enableUserFilter = isAdminMode && data.users.length > 1;

  const toggleUserSelection = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        if (next.size > 1) {
          next.delete(userId);
        }
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {
      cost: { label: t("cost") },
      calls: { label: t("calls") },
    };
    data.users.forEach((user, index) => {
      config[user.dataKey] = {
        label: user.name,
        color: getUserColor(index),
      };
    });
    return config;
  }, [data.users, t]);

  const userMap = React.useMemo(() => {
    return new Map(data.users.map((user) => [user.dataKey, user]));
  }, [data.users]);

  const visibleUsers = React.useMemo(() => {
    if (!enableUserFilter) return data.users;
    return data.users.filter((u) => selectedUserIds.has(u.id));
  }, [data.users, selectedUserIds, enableUserFilter]);

  const numericChartData = React.useMemo(() => {
    return data.chartData.map((day) => {
      const normalized: Record<string, string | number> = { ...day };
      visibleUsers.forEach((user) => {
        const costKey = `${user.dataKey}_cost`;
        const costDecimal = toDecimal(day[costKey]);
        normalized[costKey] = costDecimal ? Number(costDecimal.toDecimalPlaces(6).toString()) : 0;
        const callsKey = `${user.dataKey}_calls`;
        const callsValue = day[callsKey];
        normalized[callsKey] =
          typeof callsValue === "number" ? callsValue : Number(callsValue ?? 0);
      });
      return normalized;
    });
  }, [data.chartData, visibleUsers]);

  const userTotals = React.useMemo(() => {
    const totals: Record<string, { cost: Decimal; calls: number }> = {};
    data.users.forEach((user) => {
      totals[user.dataKey] = { cost: new Decimal(0), calls: 0 };
    });
    data.chartData.forEach((day) => {
      data.users.forEach((user) => {
        const costValue = toDecimal(day[`${user.dataKey}_cost`]);
        const callsValue = day[`${user.dataKey}_calls`];
        if (costValue) {
          const current = totals[user.dataKey];
          current.cost = current.cost.plus(costValue);
        }
        totals[user.dataKey].calls +=
          typeof callsValue === "number" ? callsValue : Number(callsValue ?? 0);
      });
    });
    return totals;
  }, [data.chartData, data.users]);

  const visibleTotals = React.useMemo(() => {
    const costTotal = data.chartData.reduce((sum, day) => {
      const dayTotal = visibleUsers.reduce((daySum, user) => {
        const costValue = toDecimal(day[`${user.dataKey}_cost`]);
        return costValue ? daySum.plus(costValue) : daySum;
      }, new Decimal(0));
      return sum.plus(dayTotal);
    }, new Decimal(0));

    const callsTotal = data.chartData.reduce((sum, day) => {
      const dayTotal = visibleUsers.reduce((daySum, user) => {
        const callsValue = day[`${user.dataKey}_calls`];
        return daySum + (typeof callsValue === "number" ? callsValue : 0);
      }, 0);
      return sum + dayTotal;
    }, 0);

    return { cost: costTotal, calls: callsTotal };
  }, [data.chartData, visibleUsers]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (data.resolution === "hour") {
      return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  };

  const formatTooltipDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (data.resolution === "hour") {
      return date.toLocaleString(locale, {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <BentoCard
      colSpan={colSpan}
      rowSpan={2}
      className={cn("flex flex-col p-0 overflow-hidden", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 dark:border-white/[0.06]">
        <div className="flex items-center gap-4 p-4">
          <h4 className="text-sm font-semibold">{t("title")}</h4>
          {/* Chart Mode Toggle */}
          {visibleUsers.length > 1 && (
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              <button
                data-active={chartMode === "overlay"}
                onClick={() => setChartMode("overlay")}
                className="data-[active=true]:bg-background data-[active=true]:shadow-sm text-[10px] text-muted-foreground px-2 py-0.5 rounded transition-colors hover:text-foreground cursor-pointer"
              >
                {t("chartMode.overlay")}
              </button>
              <button
                data-active={chartMode === "stacked"}
                onClick={() => setChartMode("stacked")}
                className="data-[active=true]:bg-background data-[active=true]:shadow-sm text-[10px] text-muted-foreground px-2 py-0.5 rounded transition-colors hover:text-foreground cursor-pointer"
              >
                {t("chartMode.stacked")}
              </button>
            </div>
          )}
        </div>

        {/* Time Range Selector */}
        {onTimeRangeChange && (
          <div className="flex items-center border-l border-border/50 dark:border-white/[0.06]">
            {TIME_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                data-active={data.timeRange === option.key}
                onClick={() => onTimeRangeChange(option.key)}
                className={cn(
                  "px-3 py-3 text-xs font-medium transition-colors cursor-pointer",
                  "border-l border-border/50 dark:border-white/[0.06] first:border-l-0",
                  "hover:bg-muted/50 dark:hover:bg-white/[0.03]",
                  "data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                )}
              >
                {t(`timeRange.${option.label}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Metric Tabs */}
      <div className="flex border-b border-border/50 dark:border-white/[0.06]">
        <button
          data-active={activeChart === "cost"}
          onClick={() => setActiveChart("cost")}
          className={cn(
            "flex-1 flex flex-col items-start gap-0.5 px-4 py-3 transition-colors cursor-pointer",
            "border-r border-border/50 dark:border-white/[0.06]",
            "hover:bg-muted/30 dark:hover:bg-white/[0.02]",
            "data-[active=true]:bg-muted/50 dark:data-[active=true]:bg-white/[0.04]"
          )}
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {t("totalCost")}
          </span>
          <span className="text-lg font-bold tabular-nums">
            {formatCurrency(visibleTotals.cost, currencyCode)}
          </span>
        </button>
        <button
          data-active={activeChart === "calls"}
          onClick={() => setActiveChart("calls")}
          className={cn(
            "flex-1 flex flex-col items-start gap-0.5 px-4 py-3 transition-colors cursor-pointer",
            "hover:bg-muted/30 dark:hover:bg-white/[0.02]",
            "data-[active=true]:bg-muted/50 dark:data-[active=true]:bg-white/[0.04]"
          )}
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {t("totalCalls")}
          </span>
          <span className="text-lg font-bold tabular-nums">
            {visibleTotals.calls.toLocaleString()}
          </span>
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1 p-4">
        <ChartContainer config={chartConfig} className="h-full w-full min-h-[200px]">
          <AreaChart data={numericChartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
            <defs>
              {data.users.map((user, index) => {
                const color = getUserColor(index);
                return (
                  <linearGradient
                    key={user.dataKey}
                    id={`fill-bento-${user.dataKey}`}
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
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              className="stroke-border/30 dark:stroke-white/[0.06]"
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatDate}
              className="text-[10px] fill-muted-foreground"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[0, "dataMax"]}
              tickFormatter={(value) =>
                activeChart === "cost"
                  ? formatCurrency(value, currencyCode)
                  : Number(value).toLocaleString()
              }
              className="text-[10px] fill-muted-foreground"
            />
            <ChartTooltip
              cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeDasharray: "4 4" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const filteredPayload = payload.filter((entry) => {
                  const value =
                    typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0);
                  return !Number.isNaN(value) && value !== 0;
                });
                if (!filteredPayload.length) return null;

                return (
                  <div className="rounded-lg border bg-card/95 backdrop-blur-sm p-3 shadow-lg min-w-[180px]">
                    <div className="text-xs font-medium text-center mb-2 pb-2 border-b border-border/50">
                      {formatTooltipDate(String(label ?? ""))}
                    </div>
                    <div className="space-y-1.5">
                      {[...filteredPayload]
                        .sort((a, b) => (Number(b.value ?? 0) || 0) - (Number(a.value ?? 0) || 0))
                        .map((entry, index) => {
                          const baseKey =
                            entry.dataKey?.toString().replace(`_${activeChart}`, "") || "";
                          const displayUser = userMap.get(baseKey);
                          const value =
                            typeof entry.value === "number"
                              ? entry.value
                              : Number(entry.value ?? 0);
                          return (
                            <div
                              key={index}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="h-2 w-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: entry.color }}
                                />
                                <span className="truncate">{displayUser?.name || baseKey}</span>
                              </div>
                              <span className="font-mono font-medium">
                                {activeChart === "cost"
                                  ? formatCurrency(value, currencyCode)
                                  : value.toLocaleString()}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              }}
            />
            {(chartMode === "overlay"
              ? [...visibleUsers].sort((a, b) => {
                  const totalA = userTotals[a.dataKey];
                  const totalB = userTotals[b.dataKey];
                  if (!totalA || !totalB) return 0;
                  if (activeChart === "cost") return totalB.cost.comparedTo(totalA.cost);
                  return totalB.calls - totalA.calls;
                })
              : visibleUsers
            ).map((user) => {
              const originalIndex = data.users.findIndex((u) => u.id === user.id);
              const color = getUserColor(originalIndex);
              return (
                <Area
                  key={user.dataKey}
                  dataKey={`${user.dataKey}_${activeChart}`}
                  name={user.name}
                  type="monotone"
                  fill={`url(#fill-bento-${user.dataKey})`}
                  stroke={color}
                  strokeWidth={2}
                  stackId={chartMode === "stacked" ? "a" : undefined}
                />
              );
            })}
          </AreaChart>
        </ChartContainer>
      </div>

      {/* Legend */}
      {enableUserFilter && (
        <div className="px-4 pb-4">
          {/* Control buttons */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <button
              onClick={() => setSelectedUserIds(new Set(data.users.map((u) => u.id)))}
              disabled={selectedUserIds.size === data.users.length}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer",
                selectedUserIds.size === data.users.length
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "text-primary hover:text-primary/80 hover:bg-primary/10"
              )}
            >
              {t("legend.selectAll")}
            </button>
            <span className="text-muted-foreground/30">|</span>
            <button
              onClick={() => {
                if (data.users.length > 0) {
                  setSelectedUserIds(new Set([data.users[0].id]));
                }
              }}
              disabled={selectedUserIds.size === 1}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer",
                selectedUserIds.size === 1
                  ? "text-muted-foreground/50 cursor-not-allowed"
                  : "text-primary hover:text-primary/80 hover:bg-primary/10"
              )}
            >
              {t("legend.deselectAll")}
            </button>
          </div>
          {/* User list with max 3 rows and scroll - only show users with non-zero usage */}
          <div className="max-h-[72px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
            <div className="flex flex-wrap gap-1.5 justify-center">
              {data.users
                .map((user, originalIndex) => ({ user, originalIndex }))
                .filter(({ user }) => {
                  const total = userTotals[user.dataKey];
                  return total && (total.cost.greaterThan(0) || total.calls > 0);
                })
                .map(({ user, originalIndex }) => {
                  const color = getUserColor(originalIndex);
                  const isSelected = selectedUserIds.has(user.id);
                  const userTotal = userTotals[user.dataKey];
                  return (
                    <button
                      key={user.dataKey}
                      onClick={() => toggleUserSelection(user.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all cursor-pointer",
                        isSelected
                          ? "bg-muted/50 ring-1 ring-border"
                          : "bg-muted/10 opacity-50 hover:opacity-75"
                      )}
                    >
                      <div
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium truncate max-w-[80px]">{user.name}</span>
                      <span className="text-muted-foreground">
                        {activeChart === "cost"
                          ? formatCurrency(userTotal?.cost ?? 0, currencyCode)
                          : (userTotal?.calls ?? 0).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </BentoCard>
  );
}
