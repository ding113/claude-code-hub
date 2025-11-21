"use client";

import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UsageLogRow } from "@/repository/usage-logs";
import { RelativeTime } from "@/components/ui/relative-time";
import { ProviderChainPopover } from "./provider-chain-popover";
import { ErrorDetailsDialog } from "./error-details-dialog";
import { formatProviderSummary } from "@/lib/utils/provider-chain-formatter";
import { ModelDisplayWithRedirect } from "./model-display-with-redirect";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import { cn, formatTokenAmount } from "@/lib/utils";

const NON_BILLING_ENDPOINT = "/v1/messages/count_tokens";

/**
 * 格式化请求耗时
 * - 1000ms 以上显示为秒（如 "1.23s"）
 * - 1000ms 以下显示为毫秒（如 "850ms"）
 */
function formatDuration(durationMs: number | null): string {
  if (!durationMs) return '-';

  // 1000ms 以上转换为秒
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  }

  // 1000ms 以下显示毫秒
  return `${durationMs}ms`;
}

interface UsageLogsTableProps {
  logs: UsageLogRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  isPending: boolean;
  newLogIds?: Set<number>; // 新增记录 ID 集合（用于动画高亮）
  currencyCode?: CurrencyCode;
}

export function UsageLogsTable({
  logs,
  total,
  page,
  pageSize,
  onPageChange,
  isPending,
  newLogIds,
  currencyCode = "USD",
}: UsageLogsTableProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("logs.columns.time")}</TableHead>
              <TableHead>{t("logs.columns.user")}</TableHead>
              <TableHead>{t("logs.columns.key")}</TableHead>
              <TableHead>{t("logs.columns.provider")}</TableHead>
              <TableHead>{t("logs.columns.model")}</TableHead>
              <TableHead className="text-right">{t("logs.columns.inputTokens")}</TableHead>
              <TableHead className="text-right">{t("logs.columns.outputTokens")}</TableHead>
              <TableHead className="text-right">{t("logs.columns.cacheWrite")}</TableHead>
              <TableHead className="text-right">{t("logs.columns.cacheRead")}</TableHead>
              <TableHead className="text-right">{t("logs.columns.cost")}</TableHead>
              <TableHead className="text-right">{t("logs.columns.duration")}</TableHead>
              <TableHead>{t("logs.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground">
                  {t("logs.table.noData")}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => {
                const isNonBilling = log.endpoint === NON_BILLING_ENDPOINT;

                return (
                  <TableRow
                    key={log.id}
                    className={cn(
                      newLogIds?.has(log.id) ? "animate-highlight-flash" : "",
                      isNonBilling ? "bg-muted/60 text-muted-foreground dark:bg-muted/20" : ""
                    )}
                    aria-label={isNonBilling ? t("logs.table.nonBilling") : undefined}
                  >
                    <TableCell className="font-mono text-xs w-[90px] max-w-[90px] overflow-hidden">
                      <div className="truncate">
                        <RelativeTime date={log.createdAt} fallback="-" />
                      </div>
                    </TableCell>
                    <TableCell>{log.userName}</TableCell>
                    <TableCell className="font-mono text-xs">{log.keyName}</TableCell>
                    <TableCell className="text-left">
                      {log.blockedBy ? (
                        // 被拦截的请求显示拦截标记
                        <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 dark:bg-orange-950 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-400" />
                          {t("logs.table.blocked")}
                        </span>
                      ) : (
                        <div className="flex items-start gap-2">
                          <div className="flex flex-col items-start gap-0.5 min-w-0 flex-1">
                            {log.providerChain && log.providerChain.length > 0 ? (
                              <>
                                <div className="w-full">
                                  <ProviderChainPopover
                                    chain={log.providerChain}
                                    finalProvider={
                                      log.providerChain[log.providerChain.length - 1].name || log.providerName || tChain("circuit.unknown")
                                    }
                                  />
                                </div>
                                {/* 摘要文字（第二行显示，左对齐） */}
                                {formatProviderSummary(log.providerChain, tChain) && (
                                  <div className="w-full">
                                    <TooltipProvider>
                                      <Tooltip delayDuration={300}>
                                        <TooltipTrigger asChild>
                                          <span className="text-xs text-muted-foreground cursor-help truncate max-w-[200px] block text-left">
                                            {formatProviderSummary(log.providerChain, tChain)}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" align="start" className="max-w-[500px]">
                                          <p className="text-xs whitespace-normal break-words font-mono">
                                            {formatProviderSummary(log.providerChain, tChain)}
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                )}
                              </>
                            ) : (
                              <span>{log.providerName || "-"}</span>
                            )}
                          </div>
                          {/* 显示供应商倍率 Badge（不为 1.0 时） */}
                          {(() => {
                            // 从决策链中找到最后一个成功的供应商，使用它的倍率
                            const successfulProvider = log.providerChain && log.providerChain.length > 0
                              ? [...log.providerChain]
                                  .reverse()
                                  .find(item =>
                                    item.reason === 'request_success' ||
                                    item.reason === 'retry_success'
                                  )
                              : null;

                            const actualCostMultiplier = successfulProvider?.costMultiplier ?? log.costMultiplier;

                            return actualCostMultiplier && parseFloat(String(actualCostMultiplier)) !== 1.0 ? (
                              <Badge
                                variant="outline"
                                className={
                                  parseFloat(String(actualCostMultiplier)) > 1.0
                                    ? "text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800 shrink-0"
                                    : "text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800 shrink-0"
                                }
                              >
                                ×{parseFloat(String(actualCostMultiplier)).toFixed(2)}
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs w-[180px] max-w-[180px]">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="truncate cursor-help">
                              <ModelDisplayWithRedirect
                                originalModel={log.originalModel}
                                currentModel={log.model}
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">{log.originalModel || log.model || "-"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatTokenAmount(log.inputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatTokenAmount(log.outputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatTokenAmount(log.cacheCreationInputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatTokenAmount(log.cacheReadInputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {isNonBilling ? "-" : log.costUsd ? formatCurrency(log.costUsd, currencyCode, 6) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatDuration(log.durationMs)}
                    </TableCell>
                    <TableCell>
                      <ErrorDetailsDialog
                        statusCode={log.statusCode}
                        errorMessage={log.errorMessage}
                        providerChain={log.providerChain}
                        sessionId={log.sessionId}
                        blockedBy={log.blockedBy}
                        blockedReason={log.blockedReason}
                        originalModel={log.originalModel}
                        currentModel={log.model}
                        userAgent={log.userAgent}
                        messagesCount={log.messagesCount}
                        endpoint={log.endpoint}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {t("logs.table.pagination", { total, page, totalPages })}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1 || isPending}
            >
              {t("logs.table.prevPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages || isPending}
            >
              {t("logs.table.nextPage")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
