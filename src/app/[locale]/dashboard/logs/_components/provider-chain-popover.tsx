"use client";

import { InfoIcon, Link2 } from "lucide-react";
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
  /** Whether a cost badge is displayed, affects name max width */
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

  // Calculate actual request count (excluding intermediate states)
  const requestCount = chain.filter(isActualRequest).length;

  // Fallback for empty string
  const displayName = finalProvider || "-";

  // Determine max width based on whether cost badge is present
  const maxWidthClass = hasCostBadge ? "max-w-[140px]" : "max-w-[180px]";

  // Check if this is a session reuse (single request from session cache)
  const isSessionReuse =
    chain[0]?.reason === "session_reuse" || chain[0]?.selectionMethod === "session_reuse";

  // If only one request, don't show popover, just show name with Tooltip
  if (requestCount <= 1) {
    return (
      <div className={`${maxWidthClass} min-w-0 w-full`}>
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span className="truncate flex items-center gap-1 cursor-help" dir="auto">
                {isSessionReuse && <Link2 className="h-3 w-3 shrink-0 text-violet-500" />}
                <span className="truncate">{displayName}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <div className="text-xs">
                {isSessionReuse && (
                  <div className="flex items-center gap-1 text-violet-500 mb-1">
                    <Link2 className="h-3 w-3" />
                    <span>{tChain("reasons.session_reuse")}</span>
                  </div>
                )}
                <p>{displayName}</p>
              </div>
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
