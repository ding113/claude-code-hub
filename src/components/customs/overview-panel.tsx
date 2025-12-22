"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { OverviewData } from "@/actions/overview";
import { getOverviewData } from "@/actions/overview";
import { Skeleton } from "@/components/ui/skeleton";
import type { CurrencyCode } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { ActiveSessionsList } from "./active-sessions-list";
import { MetricCard } from "./metric-card";

const REFRESH_INTERVAL = 5000; // 5秒刷新一次

async function fetchOverviewData(): Promise<OverviewData> {
  const result = await getOverviewData();
  if (!result.ok) {
    throw new Error(result.error || "获取概览数据失败");
  }
  return result.data;
}

interface OverviewPanelProps {
  currencyCode?: CurrencyCode;
  isAdmin?: boolean;
}

/**
 * 概览面板
 * 左侧：4个指标卡片
 * 右侧：简洁的活跃 Session 列表
 */
export function OverviewPanel({ currencyCode = "USD", isAdmin = false }: OverviewPanelProps) {
  const router = useRouter();
  const tc = useTranslations("customs");
  const tu = useTranslations("ui");

  const { data, isLoading } = useQuery<OverviewData, Error>({
    queryKey: ["overview-data"],
    queryFn: fetchOverviewData,
    refetchInterval: REFRESH_INTERVAL,
    enabled: isAdmin, // 仅当用户是 admin 时才获取数据
  });

  // 格式化响应时间
  const formatResponseTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(Number(ms) / 1000).toFixed(1)}s`;
  };

  const metrics = data || {
    concurrentSessions: 0,
    todayRequests: 0,
    todayCost: 0,
    avgResponseTime: 0,
  };

  // 对于非 admin 用户，不显示概览面板
  if (!isAdmin) {
    return null;
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full">
          <div className="lg:col-span-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`metric-skeleton-${index}`} className="rounded-lg border bg-card p-4">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-16 mt-2" />
                </div>
              ))}
            </div>
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="lg:col-span-9">
            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={`session-skeleton-${index}`} className="h-5 w-full" />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">{tu("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full">
      {/* 左侧：指标卡片区域 */}
      <div className="lg:col-span-3">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            title={tc("metrics.concurrent")}
            value={metrics.concurrentSessions}
            icon={Activity}
          />
          <MetricCard
            title={tc("metrics.todayRequests")}
            value={metrics.todayRequests}
            icon={TrendingUp}
          />
          <MetricCard
            title={tc("metrics.todayCost")}
            value={formatCurrency(metrics.todayCost, currencyCode)}
            icon={DollarSign}
          />
          <MetricCard
            title={tc("metrics.avgResponse")}
            value={metrics.avgResponseTime}
            icon={Clock}
            formatter={formatResponseTime}
          />
        </div>
        <div className="mt-3">
          <button
            onClick={() => router.push("/dashboard/sessions")}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center py-1.5 hover:bg-muted rounded-md cursor-pointer"
          >
            {tc("metrics.viewDetails")} →
          </button>
        </div>
      </div>

      {/* 右侧：活跃 Session 列表 */}
      <div className="lg:col-span-9">
        <ActiveSessionsList
          currencyCode={currencyCode}
          maxItems={10}
          showHeader={true}
          maxHeight="auto"
          className="h-full"
        />
      </div>
    </div>
  );
}
