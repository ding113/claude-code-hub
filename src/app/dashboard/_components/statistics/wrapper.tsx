"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { UserStatisticsChart } from "./chart";
import { getUserStatistics } from "@/actions/statistics";
import type { TimeRange, UserStatisticsData } from "@/types/statistics";
import type { CurrencyCode } from "@/lib/utils";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { toast } from "sonner";

interface StatisticsWrapperProps {
  initialData?: UserStatisticsData;
  currencyCode?: CurrencyCode;
}

const STATISTICS_REFRESH_INTERVAL = 5000; // 5秒刷新一次

async function fetchStatistics(timeRange: TimeRange): Promise<UserStatisticsData> {
  const result = await getUserStatistics(timeRange);
  if (!result.ok) {
    throw new Error(result.error || "获取统计数据失败");
  }
  return result.data;
}

/**
 * 统计组件包装器
 * 处理时间范围状态管理和数据获取
 */
export function StatisticsWrapper({ initialData, currencyCode = 'USD' }: StatisticsWrapperProps) {
  const [timeRange, setTimeRange] = React.useState<TimeRange>(
    initialData?.timeRange ?? DEFAULT_TIME_RANGE
  );

  const { data, error } = useQuery<UserStatisticsData, Error>({
    queryKey: ["user-statistics", timeRange],
    queryFn: () => fetchStatistics(timeRange),
    initialData,
    refetchInterval: STATISTICS_REFRESH_INTERVAL,
  });

  // 错误提示
  React.useEffect(() => {
    if (error) {
      toast.error(error.message);
    }
  }, [error]);

  // 处理时间范围变化
  const handleTimeRangeChange = React.useCallback((newTimeRange: TimeRange) => {
    setTimeRange(newTimeRange);
  }, []);

  // 如果没有数据，显示空状态
  if (!data) {
    return <div className="text-center py-8 text-muted-foreground">暂无统计数据</div>;
  }

  return (
    <UserStatisticsChart
      data={data}
      onTimeRangeChange={handleTimeRangeChange}
      currencyCode={currencyCode}
    />
  );
}
