"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getUsageLogs } from "@/actions/usage-logs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Pause, Play } from "lucide-react";
import { UsageLogsFilters } from "./usage-logs-filters";
import { UsageLogsTable } from "./usage-logs-table";
import type { UsageLogsResult } from "@/repository/usage-logs";
import type { UserDisplay } from "@/types/user";
import type { ProviderDisplay } from "@/types/provider";
import type { Key } from "@/types/key";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import { formatTokenAmount } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { BillingModelSource } from "@/types/system-config";

interface UsageLogsViewProps {
  isAdmin: boolean;
  users: UserDisplay[];
  providers: ProviderDisplay[];
  initialKeys: Key[];
  searchParams: { [key: string]: string | string[] | undefined };
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
}

export function UsageLogsView({
  isAdmin,
  users,
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
  const previousParamsRef = useRef<string>('');

  // 从 URL 参数解析筛选条件
  // 注意：时间使用字符串传递，避免 Date 序列化导致的时区问题
  const filters: {
    userId?: number;
    keyId?: number;
    providerId?: number;
    startDateLocal?: string;
    endDateLocal?: string;
    statusCode?: number;
    model?: string;
    endpoint?: string;
    page: number;
  } = {
    userId: searchParams.userId ? parseInt(searchParams.userId as string) : undefined,
    keyId: searchParams.keyId ? parseInt(searchParams.keyId as string) : undefined,
    providerId: searchParams.providerId ? parseInt(searchParams.providerId as string) : undefined,
    // 直接传递本地时间字符串，不转换为 Date
    startDateLocal: searchParams.startDate as string | undefined,
    endDateLocal: searchParams.endDate as string | undefined,
    statusCode: searchParams.statusCode ? parseInt(searchParams.statusCode as string) : undefined,
    model: searchParams.model as string | undefined,
    endpoint: searchParams.endpoint as string | undefined,
    page: searchParams.page ? parseInt(searchParams.page as string) : 1,
  };

  // 使用 ref 来存储最新的值,避免闭包陷阱
  const isPendingRef = useRef(isPending);
  const filtersRef = useRef(filters);

  isPendingRef.current = isPending;

  // 更新 filtersRef
  filtersRef.current = filters;

  // 加载数据
  // shouldDetectNew: 是否检测新增记录（只在刷新时为 true，筛选/翻页时为 false）
  const loadData = useCallback(async (shouldDetectNew = false) => {
    startTransition(async () => {
      const result = await getUsageLogs(filtersRef.current);
      if (result.ok && result.data) {
        // 只在刷新时检测新增（非筛选/翻页）
        if (shouldDetectNew && previousLogsRef.current.size > 0) {
          const newIds = result.data.logs
            .filter(log => !previousLogsRef.current.has(log.id))
            .map(log => log.id)
            .slice(0, 10); // 限制最多高亮 10 条

          if (newIds.length > 0) {
            setNewLogIds(new Set(newIds));
            // 800ms 后清除高亮
            setTimeout(() => setNewLogIds(new Set()), 800);
          }
        }

        // 更新记录缓存
        previousLogsRef.current = new Map(
          result.data.logs.map(log => [log.id, true])
        );

        setData(result.data);
        setError(null);
      } else {
        setError(!result.ok && 'error' in result ? result.error : t("logs.error.loadFailed"));
        setData(null);
      }
    });
  }, [startTransition, t]);

  // 手动刷新（检测新增）
  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    await loadData(true); // 刷新时检测新增
    setTimeout(() => setIsManualRefreshing(false), 500);
  };

  // 监听 URL 参数变化（筛选/翻页时重置缓存）
  useEffect(() => {
    const currentParams = params.toString();

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

  // 自动轮询（3秒间隔，检测新增）
  useEffect(() => {
    if (!isAutoRefresh) return;

    const intervalId = setInterval(() => {
      // 如果正在加载,跳过本次轮询
      if (isPendingRef.current) return;
      loadData(true); // 自动刷新时检测新增
    }, 3000); // 3 秒间隔

    return () => clearInterval(intervalId);
  }, [isAutoRefresh, loadData]);  

  // 处理筛选条件变更
  const handleFilterChange = (newFilters: Omit<typeof filters, 'page'>) => {
    const query = new URLSearchParams();

    if (newFilters.userId) query.set("userId", newFilters.userId.toString());
    if (newFilters.keyId) query.set("keyId", newFilters.keyId.toString());
    if (newFilters.providerId) query.set("providerId", newFilters.providerId.toString());
    // 时间直接使用字符串格式（datetime-local 返回的格式）
    if (newFilters.startDateLocal) query.set("startDate", newFilters.startDateLocal);
    if (newFilters.endDateLocal) query.set("endDate", newFilters.endDateLocal);
    if (newFilters.statusCode) query.set("statusCode", newFilters.statusCode.toString());
    if (newFilters.model) query.set("model", newFilters.model);
    if (newFilters.endpoint) query.set("endpoint", newFilters.endpoint);

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
      {/* 统计卡片 */}
      {data && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t("logs.stats.totalRequests")}</CardDescription>
              <CardTitle className="text-3xl font-mono">
                {data.summary.totalRequests.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t("logs.stats.totalAmount")}</CardDescription>
              <CardTitle className="text-3xl font-mono">
                {formatCurrency(data.summary.totalCost, currencyCode)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t("logs.stats.totalTokens")}</CardDescription>
              <CardTitle className="text-3xl font-mono">
                {formatTokenAmount(data.summary.totalTokens)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>{t("logs.stats.input")}:</span>
                <span className="font-mono">{formatTokenAmount(data.summary.totalInputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("logs.stats.output")}:</span>
                <span className="font-mono">{formatTokenAmount(data.summary.totalOutputTokens)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t("logs.stats.cacheTokens")}</CardDescription>
              <CardTitle className="text-3xl font-mono">
                {formatTokenAmount(
                  data.summary.totalCacheCreationTokens + data.summary.totalCacheReadTokens
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>{t("logs.stats.write")}:</span>
                <span className="font-mono">
                  {formatTokenAmount(data.summary.totalCacheCreationTokens)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("logs.stats.read")}:</span>
                <span className="font-mono">
                  {formatTokenAmount(data.summary.totalCacheReadTokens)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 筛选器 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("title.filterCriteria")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageLogsFilters
            isAdmin={isAdmin}
            users={users}
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
                <RefreshCw
                  className={`h-4 w-4 ${isManualRefreshing ? 'animate-spin' : ''}`}
                />
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
