"use client";

import { CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CircularProgress } from "@/components/ui/circular-progress";
import { CountdownTimer } from "@/components/ui/countdown-timer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getProviderTypeConfig } from "@/lib/provider-type-utils";
import { formatCurrency, type CurrencyCode } from "@/lib/utils/currency";
import { useTranslations } from "next-intl";
import type { ProviderType } from "@/types/provider";

interface ProviderQuota {
  cost5h: { current: number; limit: number | null; resetInfo: string };
  costDaily: { current: number; limit: number | null; resetAt?: Date };
  costWeekly: { current: number; limit: number | null; resetAt: Date };
  costMonthly: { current: number; limit: number | null; resetAt: Date };
  concurrentSessions: { current: number; limit: number };
}

interface ProviderWithQuota {
  id: number;
  name: string;
  providerType: ProviderType;
  isEnabled: boolean;
  priority: number;
  weight: number;
  quota: ProviderQuota | null;
}

interface ProviderQuotaListItemProps {
  provider: ProviderWithQuota;
  currencyCode?: CurrencyCode;
}

export function ProviderQuotaListItem({
  provider,
  currencyCode = "USD",
}: ProviderQuotaListItemProps) {
  const t = useTranslations("quota.providers");

  // 获取供应商类型配置
  const typeConfig = getProviderTypeConfig(provider.providerType);
  const TypeIcon = typeConfig.icon;

  // 渲染限额指标（圆形进度 + 倒计时）
  const renderQuotaItem = (
    label: string,
    current: number,
    limit: number | null,
    resetAt?: Date,
    resetInfo?: string
  ) => {
    if (!limit || limit <= 0) return null;

    const percentage = Math.min((current / limit) * 100, 100);

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center gap-1.5">
              {/* 标题 */}
              <span className="text-xs font-medium text-foreground/80">{label}</span>
              {/* 圆环进度 */}
              <CircularProgress value={current} max={limit} size={48} strokeWidth={4} />
              {/* 倒计时或重置信息 */}
              {resetAt ? (
                <CountdownTimer
                  targetDate={resetAt}
                  prefix={t("list.resetIn") + " "}
                  className="text-[10px] text-muted-foreground"
                />
              ) : resetInfo ? (
                <span className="text-[10px] text-muted-foreground">{resetInfo}</span>
              ) : null}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="space-y-1">
              <div className="font-semibold">{label}</div>
              <div className="text-xs">
                {t("list.current")}: {formatCurrency(current, currencyCode)}
              </div>
              <div className="text-xs">
                {t("list.limit")}: {formatCurrency(limit, currencyCode)}
              </div>
              <div className="text-xs font-semibold">
                {percentage.toFixed(1)}% {t("list.used")}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // 渲染并发Session指标
  const renderConcurrentSessionsItem = () => {
    const { current, limit } = provider.quota?.concurrentSessions || { current: 0, limit: 0 };
    if (limit <= 0) return null;

    // 计算百分比，确保上限为100%
    const percentage = Math.min((current / limit) * 100, 100);

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center gap-1.5">
              {/* 标题 */}
              <span className="text-xs font-medium text-foreground/80">
                {t("concurrentSessions.label")}
              </span>
              {/* 圆环进度 */}
              <CircularProgress value={current} max={limit} size={48} strokeWidth={4} />
              {/* 占位符，保持对齐 */}
              <span className="text-[10px] text-transparent">-</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="space-y-1">
              <div className="font-semibold">{t("concurrentSessions.label")}</div>
              <div className="text-xs">
                {t("list.current")}: {current}
              </div>
              <div className="text-xs">
                {t("list.limit")}: {limit}
              </div>
              <div className="text-xs font-semibold">
                {percentage.toFixed(1)}% {t("list.used")}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  if (!provider.quota) {
    console.warn(
      `Provider ${provider.name} (ID: ${provider.id}) has no quota data - skipping render`
    );
    return null;
  }

  return (
    <div className="flex items-center gap-4 py-4 px-4 border-b hover:bg-muted/50 transition-colors">
      {/* 左侧：状态 + 类型图标 + 名称 */}
      <div className="flex items-center gap-3 min-w-[200px]">
        {/* 启用状态指示器 */}
        {provider.isEnabled ? (
          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}

        {/* 类型图标 */}
        <div
          className={`flex items-center justify-center w-6 h-6 rounded ${typeConfig.bgColor} flex-shrink-0`}
          title={provider.providerType}
        >
          <TypeIcon className="h-3.5 w-3.5" />
        </div>

        {/* 名称和状态徽章 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{provider.name}</span>
            <Badge variant="outline" className="flex-shrink-0 text-xs">
              P:{provider.priority} W:{provider.weight}
            </Badge>
          </div>
        </div>
      </div>

      {/* 中间：限额指标（圆形进度） */}
      <div className="flex items-start gap-6 flex-1 justify-center">
        {/* 5小时限额 */}
        {provider.quota.cost5h.limit &&
          provider.quota.cost5h.limit > 0 &&
          renderQuotaItem(
            t("cost5h.label"),
            provider.quota.cost5h.current,
            provider.quota.cost5h.limit,
            undefined,
            provider.quota.cost5h.resetInfo
          )}

        {/* 每日限额 */}
        {provider.quota.costDaily.limit &&
          provider.quota.costDaily.limit > 0 &&
          renderQuotaItem(
            t("costDaily.label"),
            provider.quota.costDaily.current,
            provider.quota.costDaily.limit,
            provider.quota.costDaily.resetAt
          )}

        {/* 周限额 */}
        {provider.quota.costWeekly.limit &&
          provider.quota.costWeekly.limit > 0 &&
          renderQuotaItem(
            t("costWeekly.label"),
            provider.quota.costWeekly.current,
            provider.quota.costWeekly.limit,
            provider.quota.costWeekly.resetAt
          )}

        {/* 月限额 */}
        {provider.quota.costMonthly.limit &&
          provider.quota.costMonthly.limit > 0 &&
          renderQuotaItem(
            t("costMonthly.label"),
            provider.quota.costMonthly.current,
            provider.quota.costMonthly.limit,
            provider.quota.costMonthly.resetAt
          )}

        {/* 并发Session */}
        {renderConcurrentSessionsItem()}
      </div>

      {/* 右侧：操作区域（预留） */}
      <div className="flex items-center gap-2 flex-shrink-0">{/* 可以添加操作按钮 */}</div>
    </div>
  );
}
