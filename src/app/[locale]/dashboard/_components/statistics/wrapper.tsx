"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { getUserStatistics } from "@/actions/statistics";
import type { CurrencyCode } from "@/lib/utils";
import type { TimeRange, UserStatisticsData } from "@/types/statistics";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { UserStatisticsChart } from "./chart";

interface StatisticsWrapperProps {
  initialData?: UserStatisticsData;
  currencyCode?: CurrencyCode;
}

const STATISTICS_REFRESH_INTERVAL = 5000; // 5秒刷新一次

/**
 * 统计组件包装器
 * 处理时间范围状态管理和数据获取
 */
export function StatisticsWrapper({ initialData, currencyCode = "USD" }: StatisticsWrapperProps) {
  const t = useTranslations("dashboard.statistics");
  const [timeRange, setTimeRange] = React.useState<TimeRange>(
    initialData?.timeRange ?? DEFAULT_TIME_RANGE
  );

  const fetchStatistics = React.useCallback(
    async (timeRange: TimeRange): Promise<UserStatisticsData> => {
      const result = await getUserStatistics(timeRange);
      if (!result.ok) {
        throw new Error(result.error || t("states.fetchFailed"));
      }
      return result.data;
    },
    [t]
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
    return <div className="text-center py-8 text-muted-foreground">{t("states.noData")}</div>;
  }

  return (
    <UserStatisticsChart
      data={data}
      onTimeRangeChange={handleTimeRangeChange}
      currencyCode={currencyCode}
    />
  );
}
