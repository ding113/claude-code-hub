"use client";

import { Pause, Play, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getUsageLogs } from "@/actions/usage-logs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVisibilityPolling } from "@/hooks/use-visibility-polling";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { UsageLogsResult } from "@/repository/usage-logs";
import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";
import type { BillingModelSource } from "@/types/system-config";
import { buildLogsUrlQuery, parseLogsUrlFilters } from "../_utils/logs-query";
import { UsageLogsFilters } from "./usage-logs-filters";
import { UsageLogsStatsPanel } from "./usage-logs-stats-panel";
import { UsageLogsTable } from "./usage-logs-table";

interface UsageLogsViewProps {
  isAdmin: boolean;
  providers: ProviderDisplay[];
  initialKeys: Key[];
  searchParams: { [key: string]: string | string[] | undefined };
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
}

export function UsageLogsView({
  isAdmin,
  providers,
  initialKeys,
  searchParams,
  currencyCode = "USD",
  billingModelSource = "original",
}: UsageLogsViewProps) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<UsageLogsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // 追踪新增记录（用于动画高亮）
  const [newLogIds, setNewLogIds] = useState<Set<number>>(new Set());
  const previousLogsRef = useRef<Map<number, boolean>>(new Map());
  const previousParamsRef = useRef<string>("");

  // 从 URL 参数解析筛选条件
  // 使用毫秒时间戳传递时间，避免时区问题
  const parsedFilters = parseLogsUrlFilters(searchParams);
  const filters = { ...parsedFilters, page: parsedFilters.page ?? 1 } as const;

  // 使用 ref 来存储最新的值,避免闭包陷阱
  const isPendingRef = useRef(isPending);
  const filtersRef = useRef(filters);
  const isAutoRefreshRef = useRef(isAutoRefresh);

  isPendingRef.current = isPending;

  // 更新 filtersRef
  filtersRef.current = filters;
  isAutoRefreshRef.current = isAutoRefresh;

  // 加载数据
  // shouldDetectNew: 是否检测新增记录（只在刷新时为 true，筛选/翻页时为 false）
  const loadData = useCallback(
    async (shouldDetectNew = false) => {
      startTransition(async () => {
        const result = await getUsageLogs(filtersRef.current);
        if (result.ok && result.data) {
          // 只在刷新时检测新增（非筛选/翻页）
          if (shouldDetectNew && previousLogsRef.current.size > 0) {
            const newIds = result.data.logs
              .filter((log) => !previousLogsRef.current.has(log.id))
              .map((log) => log.id)
              .slice(0, 10); // 限制最多高亮 10 条

            if (newIds.length > 0) {
              setNewLogIds(new Set(newIds));
              // 800ms 后清除高亮
              setTimeout(() => setNewLogIds(new Set()), 800);
            }
          }

          // 更新记录缓存
          previousLogsRef.current = new Map(result.data.logs.map((log) => [log.id, true]));

          setData(result.data);
          setError(null);
        } else {
          setError(!result.ok && "error" in result ? result.error : t("logs.error.loadFailed"));
          setData(null);
        }
      });
    },
    [t]
  );

  // 手动刷新（检测新增）
  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    await loadData(true); // 刷新时检测新增
    setTimeout(() => setIsManualRefreshing(false), 500);
  };

  // 监听 URL 参数变化（筛选/翻页时重置缓存）
  useEffect(() => {
    const currentParams = params.toString();

    // 获取当前页码，如果页码 > 1 则自动暂停自动刷新
    // 避免新数据进入导致用户漏掉中间记录 (Issue #332)
    const currentPage = parseInt(params.get("page") || "1", 10);
    if (currentPage > 1 && isAutoRefreshRef.current) {
      setIsAutoRefresh(false);
    }

    if (previousParamsRef.current && previousParamsRef.current !== currentParams) {
      // URL 变化 = 用户操作（筛选/翻页），重置缓存，不检测新增
      previousLogsRef.current = new Map();
      loadData(false);
    } else if (!previousParamsRef.current) {
      // 首次加载，不检测新增
      loadData(false);
    }

    previousParamsRef.current = currentParams;
  }, [params, loadData]);

  // 自动轮询（5秒间隔，带 Page Visibility API 支持）
  // 页面不可见时暂停轮询，重新可见时立即刷新并恢复轮询
  const handlePolling = useCallback(() => {
    // 如果正在加载，跳过本次轮询
    if (isPendingRef.current) return;
    loadData(true); // 自动刷新时检测新增
  }, [loadData]);

  useVisibilityPolling(handlePolling, {
    intervalMs: 5000, // 5 秒间隔（统一轮询周期）
    enabled: isAutoRefresh,
    executeOnVisible: true, // 页面重新可见时立即刷新
  });

  // 处理筛选条件变更
  const handleFilterChange = (newFilters: Omit<typeof filters, "page">) => {
    const query = buildLogsUrlQuery(newFilters);
    router.push(`/dashboard/logs?${query.toString()}`);
  };

  // 处理分页
  const handlePageChange = (page: number) => {
    const query = new URLSearchParams(params.toString());
    query.set("page", page.toString());
    router.push(`/dashboard/logs?${query.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* 可折叠统计面板 - 默认折叠，按需加载 */}
      <UsageLogsStatsPanel
        filters={{
          userId: filters.userId,
          keyId: filters.keyId,
          providerId: filters.providerId,
          sessionId: filters.sessionId,
          startTime: filters.startTime,
          endTime: filters.endTime,
          statusCode: filters.statusCode,
          excludeStatusCode200: filters.excludeStatusCode200,
          model: filters.model,
          endpoint: filters.endpoint,
          minRetryCount: filters.minRetryCount,
        }}
        currencyCode={currencyCode}
      />

      {/* 筛选器 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("title.filterCriteria")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageLogsFilters
            isAdmin={isAdmin}
            providers={providers}
            initialKeys={initialKeys}
            filters={filters}
            onChange={handleFilterChange}
            onReset={() => router.push("/dashboard/logs")}
          />
        </CardContent>
      </Card>

      {/* 数据表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("title.usageLogs")}</CardTitle>
            <div className="flex items-center gap-2">
              {/* 手动刷新按钮 */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualRefresh}
                disabled={isPending}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`} />
                {t("logs.actions.refresh")}
              </Button>

              {/* 自动刷新开关 */}
              <Button
                variant={isAutoRefresh ? "default" : "outline"}
                size="sm"
                onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                className="gap-2"
              >
                {isAutoRefresh ? (
                  <>
                    <Pause className="h-4 w-4" />
                    {t("logs.actions.stopAutoRefresh")}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {t("logs.actions.startAutoRefresh")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8 text-destructive">{error}</div>
          ) : !data ? (
            <div className="text-center py-8 text-muted-foreground">{t("logs.stats.loading")}</div>
          ) : (
            <UsageLogsTable
              logs={data.logs}
              total={data.total}
              page={filters.page || 1}
              pageSize={50}
              onPageChange={handlePageChange}
              isPending={isPending}
              newLogIds={newLogIds}
              currencyCode={currencyCode}
              billingModelSource={billingModelSource}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
