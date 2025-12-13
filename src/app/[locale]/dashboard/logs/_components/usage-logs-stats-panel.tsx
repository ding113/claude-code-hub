"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getUsageLogsStats } from "@/actions/usage-logs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { UsageLogSummary } from "@/repository/usage-logs";

interface UsageLogsStatsPanelProps {
  filters: {
    userId?: number;
    keyId?: number;
    providerId?: number;
    startTime?: number;
    endTime?: number;
    statusCode?: number;
    excludeStatusCode200?: boolean;
    model?: string;
    endpoint?: string;
    minRetryCount?: number;
  };
  currencyCode?: CurrencyCode;
}

/**
 * 可折叠统计面板组件
 * 默认折叠，展开时按需加载聚合统计数据
 * 筛选条件变更时清除缓存，再次展开时重新加载
 */
export function UsageLogsStatsPanel({ filters, currencyCode = "USD" }: UsageLogsStatsPanelProps) {
  const t = useTranslations("dashboard");
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<UsageLogSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 创建筛选条件的稳定键用于依赖比较
  const filtersKey = JSON.stringify(filters);

  // 筛选条件变更时清除缓存
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtersKey is used to detect filter changes
  useEffect(() => {
    setStats(null);
    setError(null);
  }, [filtersKey]);

  // 加载统计数据
  const loadStats = useCallback(async () => {
    if (stats !== null || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await getUsageLogsStats(filters);
      if (result.ok && result.data) {
        setStats(result.data);
      } else {
        setError(!result.ok ? result.error : t("logs.error.loadFailed"));
      }
    } catch (err) {
      console.error("Failed to load usage logs stats:", err);
      setError(t("logs.error.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, stats, isLoading, t]);

  // 展开时加载数据
  useEffect(() => {
    if (isOpen && stats === null && !isLoading) {
      loadStats();
    }
  }, [isOpen, stats, isLoading, loadStats]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">{t("logs.stats.title")}</CardTitle>
                <CardDescription>{t("logs.stats.description")}</CardDescription>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-sm">
                  {isOpen ? t("logs.stats.collapse") : t("logs.stats.expand")}
                </span>
                {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {isLoading ? (
              <StatsSkeletons />
            ) : error ? (
              <div className="text-center py-4 text-destructive">{error}</div>
            ) : stats ? (
              <StatsContent stats={stats} currencyCode={currencyCode} />
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/**
 * 统计数据骨架屏
 */
function StatsSkeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2 p-4 border rounded-lg">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
      ))}
    </div>
  );
}

/**
 * 统计数据内容
 */
function StatsContent({
  stats,
  currencyCode,
}: {
  stats: UsageLogSummary;
  currencyCode: CurrencyCode;
}) {
  const t = useTranslations("dashboard");

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {/* 总请求数 */}
      <div className="p-4 border rounded-lg">
        <div className="text-sm text-muted-foreground mb-1">{t("logs.stats.totalRequests")}</div>
        <div className="text-2xl font-mono font-semibold">
          {stats.totalRequests.toLocaleString()}
        </div>
      </div>

      {/* 总金额 */}
      <div className="p-4 border rounded-lg">
        <div className="text-sm text-muted-foreground mb-1">{t("logs.stats.totalAmount")}</div>
        <div className="text-2xl font-mono font-semibold">
          {formatCurrency(stats.totalCost, currencyCode)}
        </div>
      </div>

      {/* 总 Tokens */}
      <div className="p-4 border rounded-lg">
        <div className="text-sm text-muted-foreground mb-1">{t("logs.stats.totalTokens")}</div>
        <div className="text-2xl font-mono font-semibold">
          {formatTokenAmount(stats.totalTokens)}
        </div>
        <div className="mt-2 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>{t("logs.stats.input")}:</span>
            <span className="font-mono">{formatTokenAmount(stats.totalInputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("logs.stats.output")}:</span>
            <span className="font-mono">{formatTokenAmount(stats.totalOutputTokens)}</span>
          </div>
        </div>
      </div>

      {/* 缓存 Tokens */}
      <div className="p-4 border rounded-lg">
        <div className="text-sm text-muted-foreground mb-1">{t("logs.stats.cacheTokens")}</div>
        <div className="text-2xl font-mono font-semibold">
          {formatTokenAmount(stats.totalCacheCreationTokens + stats.totalCacheReadTokens)}
        </div>
        <div className="mt-2 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>{t("logs.stats.write")}:</span>
            <span className="font-mono">{formatTokenAmount(stats.totalCacheCreationTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("logs.stats.read")}:</span>
            <span className="font-mono">{formatTokenAmount(stats.totalCacheReadTokens)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
