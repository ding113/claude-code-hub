"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartLegend, ChartTooltip } from "@/components/ui/chart";
import type { CurrencyCode } from "@/lib/utils";
import { cn, Decimal, formatCurrency, toDecimal } from "@/lib/utils";
import type { TimeRange, UserStatisticsData } from "@/types/statistics";
import { TimeRangeSelector } from "./time-range-selector";

// 固定的调色盘，确保新增用户也能获得可辨识的颜色
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
  "hsl(315, 85%, 65%)",
  "hsl(165, 85%, 55%)",
  "hsl(35, 85%, 65%)",
  "hsl(255, 85%, 65%)",
  "hsl(75, 85%, 50%)",
  "hsl(345, 85%, 65%)",
  "hsl(105, 85%, 55%)",
  "hsl(225, 85%, 65%)",
  "hsl(55, 85%, 60%)",
  "hsl(275, 85%, 60%)",
  "hsl(25, 85%, 65%)",
  "hsl(185, 85%, 60%)",
  "hsl(125, 85%, 55%)",
  "hsl(295, 85%, 70%)",
] as const;

// 根据索引循环分配颜色，避免重复定义数组
const getUserColor = (index: number) => USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length];

export interface UserStatisticsChartProps {
  data: UserStatisticsData;
  onTimeRangeChange?: (timeRange: TimeRange) => void;
  currencyCode?: CurrencyCode;
}

/**
 * 用户统计图表组件
 * 展示用户的消费金额和API调用次数
 */
export function UserStatisticsChart({
  data,
  onTimeRangeChange,
  currencyCode = "USD",
}: UserStatisticsChartProps) {
  const t = useTranslations("dashboard.statistics");
  const [activeChart, setActiveChart] = React.useState<"cost" | "calls">("cost");
  const [chartMode, setChartMode] = React.useState<"stacked" | "overlay">("overlay");

  // 用户选择状态(仅 Admin 用 users 模式时启用)
  const [selectedUserIds, setSelectedUserIds] = React.useState<Set<number>>(
    () => new Set(data.users.map((u) => u.id))
  );

  // 重置选择状态(当 data.users 变化时)
  React.useEffect(() => {
    setSelectedUserIds(new Set(data.users.map((u) => u.id)));
  }, [data.users]);

  const isAdminMode = data.mode === "users";
  const enableUserFilter = isAdminMode && data.users.length > 1;

  const toggleUserSelection = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        // 至少保留一个用户
        if (next.size > 1) {
          next.delete(userId);
        }
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const selectAllUsers = () => {
    setSelectedUserIds(new Set(data.users.map((u) => u.id)));
  };

  const deselectAllUsers = () => {
    // 保留第一个用户
    if (data.users.length > 0) {
      setSelectedUserIds(new Set([data.users[0].id]));
    }
  };

  // 动态生成图表配置
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {
      cost: {
        label: t("cost"),
      },
      calls: {
        label: t("calls"),
      },
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

  // 过滤可见用户(如果启用过滤)
  const visibleUsers = React.useMemo(() => {
    if (!enableUserFilter) {
      return data.users;
    }
    return data.users.filter((u) => selectedUserIds.has(u.id));
  }, [data.users, selectedUserIds, enableUserFilter]);

  const numericChartData = React.useMemo(() => {
    return data.chartData.map((day) => {
      const normalized: Record<string, string | number> = { ...day };

      // 只处理可见用户的数据
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

  // 计算每个用户的总数据(包括所有用户,用于 legend 排序)
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

  // 计算可见用户的总计(用于顶部统计卡片)
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

  const sortedLegendUsers = React.useMemo(() => {
    return data.users
      .map((user, index) => ({ user, index }))
      .sort((a, b) => {
        const totalsA = userTotals[a.user.dataKey];
        const totalsB = userTotals[b.user.dataKey];
        if (!totalsA && !totalsB) {
          return a.index - b.index;
        }

        if (!totalsA) return 1;
        if (!totalsB) return -1;

        if (activeChart === "cost") {
          const result = totalsB.cost.comparedTo(totalsA.cost);
          return result !== 0 ? result : a.index - b.index;
        }

        if (totalsB.calls === totalsA.calls) {
          return a.index - b.index;
        }

        return totalsB.calls - totalsA.calls;
      });
  }, [data.users, userTotals, activeChart]);

  // 格式化日期显示（根据分辨率）
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (data.resolution === "hour") {
      return date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else {
      return date.toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      });
    }
  };

  // 格式化tooltip日期
  const formatTooltipDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (data.resolution === "hour") {
      return date.toLocaleString("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } else {
      return date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  };

  // 获取时间范围的描述文本
  const getTimeRangeDescription = () => {
    switch (data.timeRange) {
      case "today":
        return t("timeRange.todayDescription");
      case "7days":
        return t("timeRange.7daysDescription");
      case "30days":
        return t("timeRange.30daysDescription");
      case "thisMonth":
        return t("timeRange.thisMonthDescription");
      default:
        return t("timeRange.default");
    }
  };

  const getAggregationLabel = () => {
    if (data.mode === "keys") {
      return t("mode.keys");
    } else if (data.mode === "mixed") {
      return t("mode.mixed");
    } else {
      return t("mode.users");
    }
  };

  return (
    <Card className="gap-0 py-0">
      <CardHeader
        className={cn(
          "flex flex-col items-stretch lg:flex-row",
          onTimeRangeChange && "border-b !pb-0 !px-0"
        )}
      >
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 lg:!py-0">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {getTimeRangeDescription()} · {getAggregationLabel()}
          </CardDescription>
        </div>
        {/* 时间范围选择器 */}
        {onTimeRangeChange && (
          <TimeRangeSelector
            value={data.timeRange}
            onChange={onTimeRangeChange}
            className="border-t lg:border-t-0"
          />
        )}
        {/* 如果没有时间范围选择回调，显示原有的指标切换按钮 */}
        {!onTimeRangeChange && (
          <div className="flex">
            <button
              data-active={activeChart === "cost"}
              className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l lg:border-t-0 lg:border-l lg:px-8 lg:py-6"
              onClick={() => setActiveChart("cost")}
            >
              <span className="text-muted-foreground text-xs">{t("totalCost")}</span>
              <span className="text-lg leading-none font-bold sm:text-3xl">
                {formatCurrency(visibleTotals.cost, currencyCode)}
              </span>
            </button>
            <button
              data-active={activeChart === "calls"}
              className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l lg:border-t-0 lg:border-l lg:px-8 lg:py-6"
              onClick={() => setActiveChart("calls")}
            >
              <span className="text-muted-foreground text-xs">{t("totalCalls")}</span>
              <span className="text-lg leading-none font-bold sm:text-3xl">
                {visibleTotals.calls.toLocaleString()}
              </span>
            </button>
          </div>
        )}
      </CardHeader>

      {onTimeRangeChange && (
        <div className="flex border-b">
          <button
            data-active={activeChart === "cost"}
            className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 flex-col justify-center gap-1 px-6 py-3 text-left even:border-l transition-colors hover:bg-muted/30"
            onClick={() => setActiveChart("cost")}
          >
            <span className="text-muted-foreground text-xs">{t("totalCost")}</span>
            <span className="text-lg leading-none font-bold sm:text-xl">
              {formatCurrency(visibleTotals.cost, currencyCode)}
            </span>
          </button>
          <button
            data-active={activeChart === "calls"}
            className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 flex-col justify-center gap-1 px-6 py-3 text-left even:border-l transition-colors hover:bg-muted/30"
            onClick={() => setActiveChart("calls")}
          >
            <span className="text-muted-foreground text-xs">{t("totalCalls")}</span>
            <span className="text-lg leading-none font-bold sm:text-xl">
              {visibleTotals.calls.toLocaleString()}
            </span>
          </button>
        </div>
      )}
      <CardContent className="px-1 sm:p-6 relative">
        {/* 图表模式切换（右上角，仅多用户时显示） */}
        {visibleUsers.length > 1 && (
          <div className="absolute top-0 right-0 sm:right-2 z-10">
            <div className="inline-flex rounded-md border bg-background/80 backdrop-blur-sm p-0.5">
              <button
                data-active={chartMode === "overlay"}
                onClick={() => setChartMode("overlay")}
                className="data-[active=true]:bg-muted data-[active=true]:text-foreground text-[10px] text-muted-foreground px-1.5 py-0.5 rounded transition-colors hover:bg-muted/70"
              >
                {t("chartMode.overlay")}
              </button>
              <button
                data-active={chartMode === "stacked"}
                onClick={() => setChartMode("stacked")}
                className="data-[active=true]:bg-muted data-[active=true]:text-foreground text-[10px] text-muted-foreground px-1.5 py-0.5 rounded transition-colors hover:bg-muted/70"
              >
                {t("chartMode.stacked")}
              </button>
            </div>
          </div>
        )}
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] min-h-[280px] w-full">
          <AreaChart
            data={numericChartData}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <defs>
              {data.users.map((user, index) => {
                const color = getUserColor(index);
                return (
                  <linearGradient
                    key={user.dataKey}
                    id={`fill-${user.dataKey}`}
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
              tickMargin={2}
              tickFormatter={formatDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[0, "dataMax"]}
              tickFormatter={(value) => {
                if (activeChart === "cost") {
                  return formatCurrency(value, currencyCode);
                }
                return Number(value).toLocaleString();
              }}
            />
            <ChartTooltip
              cursor={false}
              wrapperStyle={{ transform: "translateY(-100%)", marginTop: "-20px" }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;

                const filteredPayload = payload.filter((entry) => {
                  const value =
                    typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0);
                  return !Number.isNaN(value) && value !== 0;
                });

                if (!filteredPayload.length) {
                  return (
                    <div className="rounded-lg border bg-background p-3 shadow-sm min-w-[200px]">
                      <div className="font-medium text-center">
                        {formatTooltipDate(String(label ?? ""))}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="rounded-lg border bg-background p-3 shadow-sm min-w-[200px]">
                    <div className="grid gap-2">
                      <div className="font-medium text-center">
                        {formatTooltipDate(String(label ?? ""))}
                      </div>
                      <div className="grid gap-1.5">
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
                            const color = entry.color;

                            return (
                              <div
                                key={index}
                                className="flex items-center justify-between gap-3 text-sm"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    className="h-2 w-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="font-medium truncate">
                                    {displayUser?.name || baseKey}:
                                  </span>
                                </div>
                                <span className="ml-auto font-mono flex-shrink-0">
                                  {activeChart === "cost"
                                    ? formatCurrency(value, currencyCode)
                                    : value.toLocaleString()}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            {/* Overlay 模式下按数值降序渲染，大的在底层，小的在顶层避免遮挡 */}
            {(chartMode === "overlay"
              ? [...visibleUsers].sort((a, b) => {
                  const totalA = userTotals[a.dataKey];
                  const totalB = userTotals[b.dataKey];
                  if (!totalA || !totalB) return 0;
                  if (activeChart === "cost") {
                    return totalB.cost.comparedTo(totalA.cost);
                  }
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
                  fill={`url(#fill-${user.dataKey})`}
                  stroke={color}
                  stackId={chartMode === "stacked" ? "a" : undefined}
                />
              );
            })}
            <ChartLegend
              content={() => (
                <div className="px-1">
                  {/* 全选/清空按钮 (仅 Admin 且用户数 > 1 时显示) */}
                  {enableUserFilter && (
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <button
                        onClick={selectAllUsers}
                        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition-colors"
                      >
                        {t("legend.selectAll")} ({data.users.length})
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button
                        onClick={deselectAllUsers}
                        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition-colors"
                      >
                        {t("legend.deselectAll")}
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {t("legend.selected")} {selectedUserIds.size}/{data.users.length}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center gap-1">
                    {sortedLegendUsers.map(({ user, index }) => {
                      const color = getUserColor(index);
                      const userTotal = userTotals[user.dataKey] ?? {
                        cost: new Decimal(0),
                        calls: 0,
                      };
                      const isSelected = selectedUserIds.has(user.id);

                      return (
                        <div
                          key={user.dataKey}
                          onClick={() => enableUserFilter && toggleUserSelection(user.id)}
                          className={cn(
                            "rounded-md px-3 py-2 text-center transition-all min-w-16",
                            enableUserFilter && "cursor-pointer",
                            isSelected
                              ? "bg-muted/50 hover:bg-muted/70 ring-1 ring-border"
                              : "bg-muted/10 hover:bg-muted/30 opacity-50"
                          )}
                        >
                          {/* 上方：颜色点 + 用户名 */}
                          <div className="flex items-center justify-center gap-1 mb-1">
                            <div
                              className="h-2 w-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className="text-xs font-medium text-foreground truncate max-w-12">
                              {user.name}
                            </span>
                          </div>

                          {/* 下方：数据值 */}
                          <div className="text-xs font-bold text-foreground">
                            {activeChart === "cost"
                              ? formatCurrency(userTotal.cost, currencyCode)
                              : userTotal.calls.toLocaleString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
