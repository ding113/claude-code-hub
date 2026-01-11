"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatProviderDescription } from "@/lib/utils/provider-chain-formatter";
import type { ProviderChainItem } from "@/types/message";

interface ProviderChainPopoverProps {
  chain: ProviderChainItem[];
  finalProvider: string;
  /** 是否会显示倍率 Badge，影响名称最大宽度 */
  hasCostBadge?: boolean;
}

/**
 * 判断是否为实际请求记录（排除中间状态）
 */
function isActualRequest(item: ProviderChainItem): boolean {
  // 并发限制失败：算作一次尝试
  if (item.reason === "concurrent_limit_failed") return true;

  // 失败记录
  if (item.reason === "retry_failed" || item.reason === "system_error") return true;

  // 成功记录：必须有 statusCode
  if ((item.reason === "request_success" || item.reason === "retry_success") && item.statusCode) {
    return true;
  }

  // 其他都是中间状态
  return false;
}

export function ProviderChainPopover({
  chain,
  finalProvider,
  hasCostBadge = false,
}: ProviderChainPopoverProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");

  // 计算实际请求次数（排除中间状态）
  const requestCount = chain.filter(isActualRequest).length;

  // 空字符串兜底
  const displayName = finalProvider || "-";

  // 根据是否有倍率 Badge 决定名称最大宽度
  const maxWidthClass = hasCostBadge ? "max-w-[140px]" : "max-w-[180px]";

  // 如果只有一次请求，不显示 popover，只显示带 Tooltip 的名称
  if (requestCount <= 1) {
    return (
      <div className={`${maxWidthClass} min-w-0 w-full`}>
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span className="truncate block cursor-help" dir="auto">
                {displayName}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <p className="text-xs">{displayName}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 font-normal hover:bg-transparent w-full min-w-0"
          aria-label={`${displayName} - ${requestCount}${t("logs.table.times")}`}
        >
          <span className="flex w-full items-center gap-1 min-w-0">
            <div className={`${maxWidthClass} min-w-0 flex-1`}>
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <span className="truncate block cursor-help" dir="auto">
                      {displayName}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    <p className="text-xs">{displayName}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Badge variant="secondary" className="shrink-0 ml-1">
              {requestCount}
              {t("logs.table.times")}
            </Badge>
            <InfoIcon className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[500px] max-w-[calc(100vw-2rem)]" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">{t("logs.providerChain.decisionChain")}</h4>
            <Badge variant="outline">
              {requestCount}
              {t("logs.table.times")}
            </Badge>
          </div>

          <div className="rounded-md border bg-muted/50 p-4 max-h-[300px] overflow-y-auto overflow-x-hidden">
            <pre className="text-xs whitespace-pre-wrap break-words leading-relaxed">
              {formatProviderDescription(chain, tChain)}
            </pre>
          </div>

          <div className="text-xs text-muted-foreground text-center">
            {t("logs.details.clickStatusCode")}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
