"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getMyUsageLogsBatch, type MyUsageLogsBatchFilters } from "@/actions/my-usage";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useVirtualizer } from "@/hooks/use-virtualizer";
import { CURRENCY_CONFIG, cn, formatTokenAmount } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { BillingModelSource } from "@/types/system-config";

const BATCH_SIZE = 50;
const ROW_HEIGHT = 48;

interface VirtualizedUsageLogsTableProps {
  filters: MyUsageLogsBatchFilters;
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
  autoRefreshEnabled?: boolean;
  autoRefreshIntervalMs?: number;
}

export function VirtualizedUsageLogsTable({
  filters,
  currencyCode = "USD",
  billingModelSource: _billingModelSource = "original",
  autoRefreshEnabled = true,
  autoRefreshIntervalMs = 5000,
}: VirtualizedUsageLogsTableProps) {
  const t = useTranslations("myUsage.logs");
  const tCommon = useTranslations("common");
  const parentRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const shouldPoll = autoRefreshEnabled && !showScrollToTop;

  // Cursor-based infinite query
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteQuery({
      queryKey: ["my-usage-logs-batch", filters],
      queryFn: async ({ pageParam }) => {
        const result = await getMyUsageLogsBatch({
          ...filters,
          cursor: pageParam,
          limit: BATCH_SIZE,
        });
        if (!result.ok) throw new Error(result.error);
        return result.data;
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialPageParam: undefined as { createdAt: string; id: number } | undefined,
      staleTime: 30000,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => {
        if (!shouldPoll) return false;
        if (query.state.fetchStatus !== "idle") return false;
        return autoRefreshIntervalMs;
      },
    });

  const pages = data?.pages;
  const allLogs = useMemo(() => pages?.flatMap((page) => page.logs) ?? [], [pages]);

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

  const scrollToTop = useCallback(() => {
    parentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Reset scroll when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: `filters` is an intentional trigger
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [filters]);

  const handleCopyModel = useCallback(
    (modelId: string) => {
      void copyTextToClipboard(modelId).then((ok) => {
        if (ok) toast.success(tCommon("copySuccess"));
      });
    },
    [tCommon]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t("loadingMore")}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-destructive">
        {error instanceof Error ? error.message : t("loadFailed")}
      </div>
    );
  }

  if (allLogs.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">{t("noLogs")}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground/70 px-3 pt-2">
        <span>{t("loadedCount", { count: allLogs.length })}</span>
        {isFetchingNextPage && (
          <span className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("loadingMore")}
          </span>
        )}
        {!hasNextPage && allLogs.length > 0 && <span>{t("noMoreData")}</span>}
      </div>

      {/* Table with virtual scrolling */}
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Fixed header */}
          <div className="bg-muted/30 border-b sticky top-0 z-10">
            <div className="flex items-center h-8 text-[11px] font-medium text-muted-foreground/80 tracking-wide">
              <div className="flex-[0.8] min-w-[56px] pl-3 truncate" title={t("table.time")}>
                {t("table.time")}
              </div>
              <div className="flex-[1.5] min-w-[100px] px-1.5 truncate" title={t("table.model")}>
                {t("table.model")}
              </div>
              <div
                className="flex-[0.8] min-w-[70px] text-right px-1.5 truncate"
                title={t("table.tokens")}
              >
                {t("table.tokens")}
              </div>
              <div
                className="flex-[0.8] min-w-[70px] text-right px-1.5 truncate"
                title={t("table.cacheWrite")}
              >
                {t("table.cacheWrite")}
              </div>
              <div
                className="flex-[0.6] min-w-[50px] text-right px-1.5 truncate"
                title={t("table.cacheRead")}
              >
                {t("table.cacheRead")}
              </div>
              <div
                className="flex-[0.7] min-w-[50px] text-right px-1.5 truncate"
                title={t("table.cost")}
              >
                {t("table.cost")}
              </div>
              <div className="flex-[0.5] min-w-[50px] pr-3 truncate" title={t("table.status")}>
                {t("table.status")}
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
                    className="flex items-center text-sm border-b border-border/40 transition-colors hover:bg-accent/50"
                  >
                    {/* Time */}
                    <div className="flex-[0.8] min-w-[56px] font-mono text-xs truncate pl-3">
                      <RelativeTime date={log.createdAt} fallback="-" format="short" />
                    </div>

                    {/* Model */}
                    <div className="flex-[1.5] min-w-[100px] font-mono text-xs px-1.5">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {log.model ? <ModelVendorIcon modelId={log.model} /> : null}
                          {log.model ? (
                            <span
                              className="cursor-pointer hover:underline truncate"
                              onClick={() => handleCopyModel(log.model!)}
                            >
                              {log.model}
                            </span>
                          ) : (
                            <span>{t("unknownModel")}</span>
                          )}
                        </div>
                        {log.modelRedirect ? (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {log.modelRedirect}
                          </div>
                        ) : null}
                        {log.billingModel && log.billingModel !== log.model ? (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {t("billingModel", { model: log.billingModel })}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Tokens (in/out) */}
                    <div className="flex-[0.8] min-w-[70px] text-right font-mono text-xs px-1.5">
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
                            <div>Input: {formatTokenAmount(log.inputTokens)}</div>
                            <div>Output: {formatTokenAmount(log.outputTokens)}</div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>

                    {/* Cache Write */}
                    <div className="flex-[0.8] min-w-[70px] text-right font-mono text-xs px-1.5">
                      <TooltipProvider>
                        <Tooltip delayDuration={250}>
                          <TooltipTrigger asChild>
                            <div className="cursor-help flex flex-col w-full leading-tight tabular-nums">
                              <div className="flex items-center gap-1 w-full">
                                {log.cacheCreationInputTokens &&
                                log.cacheCreationInputTokens > 0 &&
                                log.cacheTtlApplied ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] leading-tight px-1 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800"
                                  >
                                    {log.cacheTtlApplied}
                                  </Badge>
                                ) : null}
                                <span className="ml-auto text-right">
                                  {formatTokenAmount(log.cacheCreationInputTokens)}
                                </span>
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent align="end" className="text-xs space-y-1">
                            <div>5m: {formatTokenAmount(log.cacheCreation5mInputTokens)}</div>
                            <div>1h: {formatTokenAmount(log.cacheCreation1hInputTokens)}</div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>

                    {/* Cache Read */}
                    <div className="flex-[0.6] min-w-[50px] text-right font-mono text-xs px-1.5 tabular-nums">
                      {formatTokenAmount(log.cacheReadInputTokens)}
                    </div>

                    {/* Cost */}
                    <div className="flex-[0.7] min-w-[50px] text-right font-mono text-xs px-1.5">
                      {CURRENCY_CONFIG[currencyCode]?.symbol ?? currencyCode}
                      {Number(log.cost ?? 0).toFixed(4)}
                    </div>

                    {/* Status */}
                    <div className="flex-[0.5] min-w-[50px] pr-3">
                      <Badge
                        variant={
                          log.statusCode && log.statusCode >= 400 ? "destructive" : "outline"
                        }
                        className={cn(
                          log.statusCode === 200
                            ? "border-green-500 text-green-600 dark:text-green-400"
                            : undefined
                        )}
                      >
                        {log.statusCode ?? "-"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Scroll to top button */}
      {showScrollToTop ? (
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-8 right-8 shadow-lg z-50"
          onClick={scrollToTop}
        >
          <ArrowUp className="h-4 w-4 mr-1" />
          {t("scrollToTop")}
        </Button>
      ) : null}
    </div>
  );
}
