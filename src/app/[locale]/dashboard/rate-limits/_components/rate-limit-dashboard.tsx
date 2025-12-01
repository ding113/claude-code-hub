"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { getRateLimitStats } from "@/actions/rate-limit-stats";
import type { CurrencyCode } from "@/lib/utils";
import type { RateLimitEventFilters, RateLimitEventStats } from "@/types/statistics";
import { RateLimitEventsChart } from "../../_components/rate-limit-events-chart";
import { RateLimitTopUsers } from "../../_components/rate-limit-top-users";
import { RateLimitTypeBreakdown } from "../../_components/rate-limit-type-breakdown";
import { RateLimitFilters } from "./rate-limit-filters";

export interface RateLimitDashboardProps {
  currencyCode?: CurrencyCode;
}

/**
 * 限流事件统计仪表板
 * 包含过滤器和三个可视化组件
 */
export function RateLimitDashboard(_props: RateLimitDashboardProps) {
  const t = useTranslations("dashboard.rateLimits");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState<RateLimitEventStats | null>(null);
  const [filters, setFilters] = React.useState<RateLimitEventFilters>({
    start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 默认过去7天
    end_time: new Date(),
  });

  // 加载统计数据
  const loadStats = React.useCallback(async (newFilters: RateLimitEventFilters) => {
    setLoading(true);
    setError(null);

    try {
      const result = await getRateLimitStats(newFilters);

      if (result.ok) {
        setStats(result.data);
      } else {
        setError(result.error || "Failed to load statistics");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  React.useEffect(() => {
    loadStats(filters);
  }, [filters, loadStats]);

  // 处理过滤器变化
  const handleFiltersChange = (newFilters: RateLimitEventFilters) => {
    setFilters(newFilters);
    loadStats(newFilters);
  };

  return (
    <div className="space-y-6">
      {/* 过滤器 */}
      <RateLimitFilters
        initialFilters={filters}
        onFiltersChange={handleFiltersChange}
        disabled={loading}
      />

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">{t("loading")}</span>
        </div>
      )}

      {/* 错误状态 */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          <p className="font-medium">{t("error")}</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* 统计数据展示 */}
      {stats && !loading && !error && (
        <>
          {/* 总览卡片 */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">{t("totalEvents")}</div>
              <div className="text-2xl font-bold">{stats.total_events.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">{t("avgUsage")}</div>
              <div className="text-2xl font-bold">{stats.avg_current_usage.toFixed(1)}%</div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">{t("affectedUsers")}</div>
              <div className="text-2xl font-bold">
                {Object.keys(stats.events_by_user).length.toLocaleString()}
              </div>
            </div>
          </div>

          {/* 时间线图表 */}
          <RateLimitEventsChart data={stats.events_timeline} />

          {/* 限流类型分布和受影响用户 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <RateLimitTypeBreakdown data={stats.events_by_type} />
            <RateLimitTopUsers data={stats.events_by_user} />
          </div>
        </>
      )}

      {/* 空状态 */}
      {stats && stats.total_events === 0 && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">{t("noData")}</p>
          <p className="text-sm text-muted-foreground">{t("noDataHint")}</p>
        </div>
      )}
    </div>
  );
}
