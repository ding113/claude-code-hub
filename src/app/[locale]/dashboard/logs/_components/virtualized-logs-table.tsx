"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getUsageLogsBatch } from "@/actions/usage-logs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useVirtualizer } from "@/hooks/use-virtualizer";
import { cn, formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import {
  calculateOutputRate,
  formatDuration,
  NON_BILLING_ENDPOINT,
} from "@/lib/utils/performance-formatter";
import { formatProviderSummary } from "@/lib/utils/provider-chain-formatter";
import type { BillingModelSource } from "@/types/system-config";
import { ErrorDetailsDialog } from "./error-details-dialog";
import { ModelDisplayWithRedirect } from "./model-display-with-redirect";
import { ProviderChainPopover } from "./provider-chain-popover";

const BATCH_SIZE = 50;
const ROW_HEIGHT = 52; // Estimated row height in pixels

export interface VirtualizedLogsTableFilters {
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
}

interface VirtualizedLogsTableProps {
  filters: VirtualizedLogsTableFilters;
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
  autoRefreshEnabled?: boolean;
  autoRefreshIntervalMs?: number;
}

export function VirtualizedLogsTable({
  filters,
  currencyCode = "USD",
  billingModelSource = "original",
  autoRefreshEnabled = true,
  autoRefreshIntervalMs = 5000,
}: VirtualizedLogsTableProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");
  const parentRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  // Dialog state for model redirect click
  const [dialogState, setDialogState] = useState<{
    logId: number | null;
    scrollToRedirect: boolean;
  }>({ logId: null, scrollToRedirect: false });

  // Infinite query with cursor-based pagination
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteQuery({
      queryKey: ["usage-logs-batch", filters],
      queryFn: async ({ pageParam }) => {
        const result = await getUsageLogsBatch({
          ...filters,
          cursor: pageParam,
          limit: BATCH_SIZE,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        return result.data;
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialPageParam: undefined as { createdAt: string; id: number } | undefined,
      staleTime: 30000, // 30 seconds
      refetchOnWindowFocus: false,
      refetchInterval: autoRefreshEnabled ? autoRefreshIntervalMs : false,
    });

  // Flatten all pages into a single array
  const allLogs = data?.pages.flatMap((page) => page.logs) ?? [];

  // Virtual list setup
  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? allLogs.length + 1 : allLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  // Auto-fetch next page when scrolling near the bottom
  useEffect(() => {
    // If the last visible item is a loading row or near the end, fetch more
    if (lastItemIndex >= allLogs.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [lastItemIndex, hasNextPage, isFetchingNextPage, allLogs.length, fetchNextPage]);

  // Track scroll position for "scroll to top" button
  const handleScroll = useCallback(() => {
    if (parentRef.current) {
      setShowScrollToTop(parentRef.current.scrollTop > 500);
    }
  }, []);

  // Scroll to top handler
  const scrollToTop = useCallback(() => {
    parentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Reset scroll when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is intentionally used to trigger scroll reset on filter change
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [filters]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t("logs.stats.loading")}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-destructive">
        {error instanceof Error ? error.message : t("logs.error.loadFailed")}
      </div>
    );
  }

  if (allLogs.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">{t("logs.table.noData")}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("logs.table.loadedCount", { count: allLogs.length })}</span>
        {isFetchingNextPage && (
          <span className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("logs.table.loadingMore")}
          </span>
        )}
        {!hasNextPage && allLogs.length > 0 && <span>{t("logs.table.noMoreData")}</span>}
      </div>

      {/* Table with virtual scrolling */}
      <div className="rounded-md border overflow-hidden">
        {/* Fixed header */}
        <div className="bg-muted/50 border-b">
          <div className="flex items-center h-10 text-sm font-medium text-muted-foreground">
            <div className="flex-[0.8] min-w-[80px] pl-2 truncate" title={t("logs.columns.time")}>
              {t("logs.columns.time")}
            </div>
            <div className="flex-[0.6] min-w-[50px] px-1 truncate" title={t("logs.columns.user")}>
              {t("logs.columns.user")}
            </div>
            <div className="flex-[0.6] min-w-[50px] px-1 truncate" title={t("logs.columns.key")}>
              {t("logs.columns.key")}
            </div>
            <div
              className="flex-[1.5] min-w-[100px] px-1 truncate"
              title={t("logs.columns.provider")}
            >
              {t("logs.columns.provider")}
            </div>
            <div className="flex-[1] min-w-[80px] px-1 truncate" title={t("logs.columns.model")}>
              {t("logs.columns.model")}
            </div>
            <div
              className="flex-[0.7] min-w-[70px] text-right px-1 truncate"
              title={t("logs.columns.tokens")}
            >
              {t("logs.columns.tokens")}
            </div>
            <div
              className="flex-[0.8] min-w-[70px] text-right px-1 truncate"
              title={t("logs.columns.cache")}
            >
              {t("logs.columns.cache")}
            </div>
            <div
              className="flex-[0.7] min-w-[60px] text-right px-1 truncate"
              title={t("logs.columns.cost")}
            >
              {t("logs.columns.cost")}
            </div>
            <div
              className="flex-[0.8] min-w-[80px] text-right px-1 truncate"
              title={t("logs.columns.performance")}
            >
              {t("logs.columns.performance")}
            </div>
            <div className="flex-[0.7] min-w-[70px] pr-2 truncate" title={t("logs.columns.status")}>
              {t("logs.columns.status")}
            </div>
          </div>
        </div>

        {/* Virtualized body */}
        <div ref={parentRef} className="h-[600px] overflow-auto" onScroll={handleScroll}>
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= allLogs.length;
              const log = allLogs[virtualRow.index];

              if (isLoaderRow) {
                return (
                  <div
                    key="loader"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex items-center justify-center"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                );
              }

              const isNonBilling = log.endpoint === NON_BILLING_ENDPOINT;

              return (
                <div
                  key={log.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    "flex items-center text-sm border-b hover:bg-muted/50",
                    isNonBilling ? "bg-muted/60 text-muted-foreground dark:bg-muted/20" : ""
                  )}
                >
                  {/* Time */}
                  <div className="flex-[0.8] min-w-[80px] font-mono text-xs truncate pl-2">
                    <RelativeTime date={log.createdAt} fallback="-" />
                  </div>

                  {/* User */}
                  <div className="flex-[0.6] min-w-[50px] truncate px-1" title={log.userName}>
                    {log.userName}
                  </div>

                  {/* Key */}
                  <div
                    className="flex-[0.6] min-w-[50px] font-mono text-xs truncate px-1"
                    title={log.keyName}
                  >
                    {log.keyName}
                  </div>

                  {/* Provider */}
                  <div className="flex-[1.5] min-w-[100px] px-1">
                    {log.blockedBy ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 dark:bg-orange-950 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-400" />
                        {t("logs.table.blocked")}
                      </span>
                    ) : (
                      <div className="flex flex-col items-start gap-0.5 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          {(() => {
                            // 计算倍率，用于判断是否显示 Badge
                            const successfulProvider =
                              log.providerChain && log.providerChain.length > 0
                                ? [...log.providerChain]
                                    .reverse()
                                    .find(
                                      (item) =>
                                        item.reason === "request_success" ||
                                        item.reason === "retry_success"
                                    )
                                : null;
                            const actualCostMultiplier =
                              successfulProvider?.costMultiplier ?? log.costMultiplier;
                            const hasCostBadge =
                              !!actualCostMultiplier &&
                              parseFloat(String(actualCostMultiplier)) !== 1.0;

                            return (
                              <>
                                <ProviderChainPopover
                                  chain={log.providerChain ?? []}
                                  finalProvider={
                                    (log.providerChain && log.providerChain.length > 0
                                      ? log.providerChain[log.providerChain.length - 1].name
                                      : null) ||
                                    log.providerName ||
                                    tChain("circuit.unknown")
                                  }
                                  hasCostBadge={hasCostBadge}
                                />
                                {/* Cost multiplier badge */}
                                {hasCostBadge && (
                                  <Badge
                                    variant="outline"
                                    className={
                                      parseFloat(String(actualCostMultiplier)) > 1.0
                                        ? "text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800 shrink-0"
                                        : "text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800 shrink-0"
                                    }
                                  >
                                    x{parseFloat(String(actualCostMultiplier)).toFixed(2)}
                                  </Badge>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        {log.providerChain &&
                          log.providerChain.length > 0 &&
                          formatProviderSummary(log.providerChain, tChain) && (
                            <TooltipProvider>
                              <Tooltip delayDuration={300}>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground cursor-help truncate max-w-[180px] block text-left">
                                    {formatProviderSummary(log.providerChain, tChain)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  className="max-w-[500px]"
                                >
                                  <p className="text-xs whitespace-normal break-words font-mono">
                                    {formatProviderSummary(log.providerChain, tChain)}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                      </div>
                    )}
                  </div>

                  {/* Model */}
                  <div className="flex-[1] min-w-[80px] font-mono text-xs px-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1 min-w-0 cursor-help truncate">
                            <ModelDisplayWithRedirect
                              originalModel={log.originalModel}
                              currentModel={log.model}
                              billingModelSource={billingModelSource}
                              onRedirectClick={() =>
                                setDialogState({ logId: log.id, scrollToRedirect: true })
                              }
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">{log.originalModel || log.model || "-"}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Tokens */}
                  <div className="flex-[0.7] min-w-[70px] text-right font-mono text-xs px-1">
                    <TooltipProvider>
                      <Tooltip delayDuration={250}>
                        <TooltipTrigger asChild>
                          <div className="cursor-help flex flex-col items-end leading-tight tabular-nums">
                            <span>{formatTokenAmount(log.inputTokens)}</span>
                            <span className="text-muted-foreground">
                              {formatTokenAmount(log.outputTokens)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent align="end" className="text-xs space-y-1">
                          <div>
                            {t("logs.billingDetails.input")}: {formatTokenAmount(log.inputTokens)}
                          </div>
                          <div>
                            {t("logs.billingDetails.output")}: {formatTokenAmount(log.outputTokens)}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Cache */}
                  <div className="flex-[0.8] min-w-[70px] text-right font-mono text-xs px-1">
                    <TooltipProvider>
                      <Tooltip delayDuration={250}>
                        <TooltipTrigger asChild>
                          <div className="cursor-help flex flex-col items-end leading-tight tabular-nums">
                            <div className="flex items-center gap-1">
                              <span>{formatTokenAmount(log.cacheCreationInputTokens)}</span>
                              {log.cacheTtlApplied ? (
                                <Badge variant="outline" className="text-[10px] leading-tight px-1">
                                  {log.cacheTtlApplied}
                                </Badge>
                              ) : null}
                            </div>
                            <span className="text-muted-foreground">
                              {formatTokenAmount(log.cacheReadInputTokens)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent align="end" className="text-xs space-y-1">
                          <div className="font-medium">{t("logs.columns.cacheWrite")}</div>
                          <div className="pl-2">
                            5m:{" "}
                            {formatTokenAmount(
                              (log.cacheCreation5mInputTokens ?? 0) > 0
                                ? log.cacheCreation5mInputTokens
                                : log.cacheTtlApplied !== "1h"
                                  ? log.cacheCreationInputTokens
                                  : 0
                            )}
                          </div>
                          <div className="pl-2">
                            1h:{" "}
                            {formatTokenAmount(
                              (log.cacheCreation1hInputTokens ?? 0) > 0
                                ? log.cacheCreation1hInputTokens
                                : log.cacheTtlApplied === "1h"
                                  ? log.cacheCreationInputTokens
                                  : 0
                            )}
                          </div>
                          <div className="font-medium mt-1">{t("logs.columns.cacheRead")}</div>
                          <div className="pl-2">{formatTokenAmount(log.cacheReadInputTokens)}</div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Cost */}
                  <div className="flex-[0.7] min-w-[60px] text-right font-mono text-xs px-1">
                    {isNonBilling ? (
                      "-"
                    ) : log.costUsd ? (
                      <TooltipProvider>
                        <Tooltip delayDuration={250}>
                          <TooltipTrigger asChild>
                            <span className="cursor-help inline-flex items-center gap-1">
                              {formatCurrency(log.costUsd, currencyCode, 6)}
                              {log.context1mApplied && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] leading-tight px-1 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
                                >
                                  1M
                                </Badge>
                              )}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent align="end" className="text-xs space-y-1 max-w-[300px]">
                            {log.context1mApplied && (
                              <div className="text-purple-600 dark:text-purple-400 font-medium">
                                {t("logs.billingDetails.context1m")}
                              </div>
                            )}
                            <div>
                              {t("logs.billingDetails.input")}: {formatTokenAmount(log.inputTokens)}{" "}
                              tokens
                            </div>
                            <div>
                              {t("logs.billingDetails.output")}:{" "}
                              {formatTokenAmount(log.outputTokens)} tokens
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      "-"
                    )}
                  </div>

                  {/* Performance */}
                  <div className="flex-[0.8] min-w-[80px] text-right font-mono text-xs px-1">
                    {(() => {
                      const rate = calculateOutputRate(
                        log.outputTokens,
                        log.durationMs,
                        log.ttfbMs
                      );
                      const ttfbLine =
                        log.ttfbMs != null && log.ttfbMs > 0
                          ? `TTFB ${formatDuration(log.ttfbMs)}`
                          : null;
                      const rateLine = rate !== null ? `${rate.toFixed(0)} tok/s` : null;

                      return (
                        <TooltipProvider>
                          <Tooltip delayDuration={250}>
                            <TooltipTrigger asChild>
                              <div className="flex flex-col items-end cursor-help">
                                <span>{formatDuration(log.durationMs)}</span>
                                {ttfbLine && (
                                  <span className="text-muted-foreground text-[10px]">
                                    {ttfbLine}
                                  </span>
                                )}
                                {rateLine && (
                                  <span className="text-muted-foreground text-[10px]">
                                    {rateLine}
                                  </span>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent align="end" className="text-xs space-y-1">
                              <div>
                                {t("logs.details.performance.duration")}:{" "}
                                {formatDuration(log.durationMs)}
                              </div>
                              {log.ttfbMs != null && (
                                <div>
                                  {t("logs.details.performance.ttfb")}: {formatDuration(log.ttfbMs)}
                                </div>
                              )}
                              {rate !== null && (
                                <div>
                                  {t("logs.details.performance.outputRate")}: {rate.toFixed(1)}{" "}
                                  tok/s
                                </div>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })()}
                  </div>

                  {/* Status */}
                  <div className="flex-[0.7] min-w-[70px] pr-2">
                    <ErrorDetailsDialog
                      statusCode={log.statusCode}
                      errorMessage={log.errorMessage}
                      providerChain={log.providerChain}
                      sessionId={log.sessionId}
                      requestSequence={log.requestSequence}
                      blockedBy={log.blockedBy}
                      blockedReason={log.blockedReason}
                      originalModel={log.originalModel}
                      currentModel={log.model}
                      userAgent={log.userAgent}
                      messagesCount={log.messagesCount}
                      endpoint={log.endpoint}
                      billingModelSource={billingModelSource}
                      inputTokens={log.inputTokens}
                      outputTokens={log.outputTokens}
                      cacheCreationInputTokens={log.cacheCreationInputTokens}
                      cacheCreation5mInputTokens={log.cacheCreation5mInputTokens}
                      cacheCreation1hInputTokens={log.cacheCreation1hInputTokens}
                      cacheReadInputTokens={log.cacheReadInputTokens}
                      cacheTtlApplied={log.cacheTtlApplied}
                      costUsd={log.costUsd}
                      costMultiplier={log.costMultiplier}
                      context1mApplied={log.context1mApplied}
                      durationMs={log.durationMs}
                      ttfbMs={log.ttfbMs}
                      externalOpen={dialogState.logId === log.id ? true : undefined}
                      onExternalOpenChange={(open) => {
                        if (!open) setDialogState({ logId: null, scrollToRedirect: false });
                      }}
                      scrollToRedirect={
                        dialogState.logId === log.id && dialogState.scrollToRedirect
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scroll to top button */}
      {showScrollToTop && (
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-8 right-8 shadow-lg z-50"
          onClick={scrollToTop}
        >
          <ArrowUp className="h-4 w-4 mr-1" />
          {t("logs.table.scrollToTop")}
        </Button>
      )}
    </div>
  );
}
