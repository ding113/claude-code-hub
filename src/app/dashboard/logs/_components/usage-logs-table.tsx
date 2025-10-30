"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UsageLogRow } from "@/repository/usage-logs";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ProviderChainPopover } from "./provider-chain-popover";
import { ErrorDetailsDialog } from "./error-details-dialog";
import { formatProviderSummary } from "@/lib/utils/provider-chain-formatter";
import { ModelDisplayWithRedirect } from "./model-display-with-redirect";
import { formatCurrency } from "@/lib/utils/currency";
import type { PrivacyFilterContext } from "@/lib/utils/privacy-filter";
import {
  filterProviderName,
  filterCostMultiplier,
  filterProviderChain,
} from "@/lib/utils/privacy-filter";
import { calculateDisplayCost } from "@/repository/_shared/cost-calculator";

/**
 * 格式化时间显示
 * - 1分钟以内显示具体秒数（如 "30秒前"）
 * - 超过1分钟使用相对时间（如 "2小时前"）
 */
function formatTimeAgo(date: Date | null): string {
  if (!date) return '-';

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // 1分钟以内显示秒数
  if (diffInSeconds < 60) {
    return `${diffInSeconds}秒前`;
  }

  // 超过1分钟使用相对时间
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: zhCN,
  });
}

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
  privacyContext: PrivacyFilterContext;
}

export function UsageLogsTable({
  logs,
  total,
  page,
  pageSize,
  onPageChange,
  isPending,
  newLogIds,
  privacyContext,
}: UsageLogsTableProps) {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>密钥</TableHead>
              <TableHead>供应商</TableHead>
              <TableHead>模型</TableHead>
              <TableHead className="text-right">输入</TableHead>
              <TableHead className="text-right">输出</TableHead>
              <TableHead className="text-right">缓存写入</TableHead>
              <TableHead className="text-right">缓存读取</TableHead>
              <TableHead className="text-right">成本</TableHead>
              <TableHead className="text-right">耗时</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow
                  key={log.id}
                  className={newLogIds?.has(log.id) ? 'animate-highlight-flash' : ''}
                >
                  <TableCell className="font-mono text-xs">
                    {formatTimeAgo(log.createdAt)}
                  </TableCell>
                  <TableCell>{log.userName}</TableCell>
                  <TableCell className="font-mono text-xs">{log.keyName}</TableCell>
                  <TableCell className="text-left">
                    {log.blockedBy ? (
                      // 被拦截的请求显示拦截标记
                      <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 dark:bg-orange-950 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-400" />
                        被拦截
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        {log.providerChain && log.providerChain.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            <ProviderChainPopover
                              chain={filterProviderChain(log.providerChain, privacyContext) || []}
                              finalProvider={filterProviderName(log.providerName, privacyContext)}
                            />
                            {/* 摘要文字（仅在有决策链时显示，且允许查看供应商信息时） */}
                            {(privacyContext.isAdmin || privacyContext.allowViewProviderInfo) &&
                              formatProviderSummary(log.providerChain) && (
                                <span className="text-xs text-muted-foreground">
                                  {formatProviderSummary(log.providerChain)}
                                </span>
                              )}
                          </div>
                        ) : (
                          <span>{filterProviderName(log.providerName, privacyContext)}</span>
                        )}
                        {/* 显示供应商倍率 Badge（不为 1.0 时，且允许查看供应商信息时） */}
                        {(() => {
                          const multiplier = filterCostMultiplier(log.costMultiplier, privacyContext);
                          return (
                            multiplier &&
                            multiplier !== 1.0 && (
                              <Badge
                                variant={
                                  multiplier > 1.0
                                    ? "destructive" // 加价，红色
                                    : "secondary" // 折扣，灰色
                                }
                                className={
                                  multiplier < 1.0
                                    ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" // 折扣用绿色
                                    : undefined
                                }
                              >
                                ×{multiplier.toFixed(2)}
                              </Badge>
                            )
                          );
                        })()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <ModelDisplayWithRedirect
                      originalModel={log.originalModel}
                      currentModel={log.model}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.inputTokens?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.outputTokens?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.cacheCreationInputTokens?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.cacheReadInputTokens?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {log.costUsd
                      ? formatCurrency(
                          calculateDisplayCost(log.costUsd, log.costMultiplier, privacyContext),
                          privacyContext.userCurrency,
                          6
                        )
                      : "-"}
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
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            共 {total} 条记录，第 {page} / {totalPages} 页
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1 || isPending}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages || isPending}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
