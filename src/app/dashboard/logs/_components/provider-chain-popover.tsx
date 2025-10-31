"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoIcon } from "lucide-react";
import type { ProviderChainItem } from "@/types/message";
import { formatProviderDescription } from "@/lib/utils/provider-chain-formatter";

interface ProviderChainPopoverProps {
  chain: ProviderChainItem[];
  finalProvider: string;
}

/**
 * 判断是否为实际请求记录（排除中间状态）
 */
function isActualRequest(item: ProviderChainItem): boolean {
  // 并发限制失败：算作一次尝试
  if (item.reason === 'concurrent_limit_failed') return true;

  // 失败记录
  if (item.reason === 'retry_failed' || item.reason === 'system_error') return true;

  // 成功记录：必须有 statusCode
  if ((item.reason === 'request_success' || item.reason === 'retry_success') && item.statusCode) {
    return true;
  }

  // 其他都是中间状态
  return false;
}

export function ProviderChainPopover({ chain, finalProvider }: ProviderChainPopoverProps) {
  // 计算实际请求次数（排除中间状态）
  const requestCount = chain.filter(isActualRequest).length;

  // 如果只有一次请求，不显示 popover
  if (requestCount <= 1) {
    return <span>{finalProvider}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">
          <span className="flex items-center gap-1">
            {finalProvider}
            <Badge variant="secondary" className="ml-1">
              {requestCount}次
            </Badge>
            <InfoIcon className="h-3 w-3 text-muted-foreground" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[500px]" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">供应商决策链</h4>
            <Badge variant="outline">{requestCount}次</Badge>
          </div>

          <div className="rounded-md border bg-muted/50 p-4 max-h-[300px] overflow-y-auto overflow-x-hidden">
            <pre className="text-xs whitespace-pre-wrap break-words leading-relaxed">
              {formatProviderDescription(chain)}
            </pre>
          </div>

          <div className="text-xs text-muted-foreground text-center">
            点击状态码查看完整时间线
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
