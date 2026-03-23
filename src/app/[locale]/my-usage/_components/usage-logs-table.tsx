"use client";

import { formatInTimeZone } from "date-fns-tz";
import { ArrowUp, Loader2 } from "lucide-react";
import { useTimeZone, useTranslations } from "next-intl";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { MyUsageLogEntry } from "@/actions/my-usage";
import { ModelVendorIcon } from "@/components/customs/model-vendor-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useVirtualizedInfiniteList } from "@/hooks/use-virtualized-infinite-list";
import { CURRENCY_CONFIG, type CurrencyCode } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/utils/clipboard";

const ROW_HEIGHT = 80;

interface UsageLogsTableProps {
  logs: MyUsageLogEntry[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  currencyCode?: CurrencyCode;
  loading?: boolean;
  loadingLabel?: string;
  errorMessage?: string | null;
  onLoadMore?: () => void;
  resetScrollKey?: unknown;
  onHistoryBrowsingChange?: (isBrowsingHistory: boolean) => void;
}

export function UsageLogsTable({
  logs,
  hasNextPage,
  isFetchingNextPage,
  currencyCode = "USD",
  loading = false,
  loadingLabel,
  errorMessage,
  onLoadMore,
  resetScrollKey,
  onHistoryBrowsingChange,
}: UsageLogsTableProps) {
  const t = useTranslations("myUsage.logs");
  const tCommon = useTranslations("common");
  const tDashboard = useTranslations("dashboard");
  const timeZone = useTimeZone() ?? "UTC";
  const resolvedResetKey = useMemo(() => JSON.stringify(resetScrollKey ?? null), [resetScrollKey]);
  const previousResetKeyRef = useRef(resolvedResetKey);

  const formatTokenAmount = (value: number | null | undefined): string => {
    if (value == null || value === 0) return "-";
    return value.toLocaleString();
  };

  const handleCopyModel = useCallback(
    (modelId: string) => {
      void copyTextToClipboard(modelId).then((ok) => {
        if (ok) toast.success(tCommon("copySuccess"));
      });
    },
    [tCommon]
  );
  const handleLoadMore = useCallback(() => {
    onLoadMore?.();
    return undefined;
  }, [onLoadMore]);

  const getItemKey = useCallback((index: number) => logs[index]?.id ?? `loader-${index}`, [logs]);

  const {
    parentRef,
    rowVirtualizer,
    virtualItems,
    showScrollToTop,
    handleScroll,
    scrollToTop,
    resetScrollPosition,
  } = useVirtualizedInfiniteList({
    itemCount: logs.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: handleLoadMore,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey,
  });

  useEffect(() => {
    onHistoryBrowsingChange?.(showScrollToTop);
  }, [showScrollToTop, onHistoryBrowsingChange]);

  const handleResetKeyChange = useEffectEvent((nextResetKey: string) => {
    if (previousResetKeyRef.current === nextResetKey) return;
    previousResetKeyRef.current = nextResetKey;
    resetScrollPosition();
  });

  useEffect(() => {
    handleResetKeyChange(resolvedResetKey);
  }, [resolvedResetKey]);

  useEffect(() => {
    return () => {
      onHistoryBrowsingChange?.(false);
    };
  }, [onHistoryBrowsingChange]);

  if (loading && logs.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border">
          <div className="grid grid-cols-7 gap-3 p-3">
            {Array.from({ length: 6 }).map((_, rowIndex) => (
              <div key={rowIndex} className="contents">
                {Array.from({ length: 7 }).map((__, cellIndex) => (
                  <Skeleton key={`${rowIndex}-${cellIndex}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </div>
        {loadingLabel ? <div className="text-xs text-muted-foreground">{loadingLabel}</div> : null}
      </div>
    );
  }

  if (errorMessage && logs.length === 0) {
    return <div className="text-center py-8 text-destructive">{errorMessage}</div>;
  }

  if (logs.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">{t("noLogs")}</div>;
  }

  return (
    <div className="space-y-4">
      {errorMessage ? <div className="px-1 text-xs text-destructive">{errorMessage}</div> : null}

      <div className="flex items-center justify-between text-xs text-muted-foreground/70 px-1 pt-1">
        <span>{tDashboard("logs.table.loadedCount", { count: logs.length })}</span>
        {errorMessage && onLoadMore ? (
          <span className="flex items-center gap-2 text-destructive">
            <span>{errorMessage}</span>
            <Button size="sm" variant="outline" onClick={onLoadMore}>
              {tCommon("retry")}
            </Button>
          </span>
        ) : isFetchingNextPage ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            {tDashboard("logs.table.loadingMore")}
          </span>
        ) : !hasNextPage ? (
          <span>{tDashboard("logs.table.noMoreData")}</span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[860px] rounded-md border">
          <div className="bg-muted/30 border-b sticky top-0 z-10">
            <div className="flex items-center h-9 text-[11px] font-medium text-muted-foreground/80 tracking-wide">
              <div className="flex-[1] min-w-[150px] px-3">{t("table.time")}</div>
              <div className="flex-[2.2] min-w-[240px] px-2">{t("table.model")}</div>
              <div className="flex-[0.9] min-w-[100px] px-2 text-right">{t("table.tokens")}</div>
              <div className="flex-[1] min-w-[120px] px-2 text-right">{t("table.cacheWrite")}</div>
              <div className="flex-[0.8] min-w-[90px] px-2 text-right">{t("table.cacheRead")}</div>
              <div className="flex-[0.8] min-w-[90px] px-2 text-right">{t("table.cost")}</div>
              <div className="flex-[0.7] min-w-[80px] px-3">{t("table.status")}</div>
            </div>
          </div>

          <div
            ref={parentRef}
            className="h-[520px] overflow-y-auto overflow-x-hidden"
            onScroll={handleScroll}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((virtualRow) => {
                const isLoaderRow = virtualRow.index >= logs.length;
                const log = logs[virtualRow.index];

                if (isLoaderRow) {
                  return (
                    <div
                      key={`loader-${virtualRow.index}`}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="flex items-center justify-center border-b"
                    >
                      {errorMessage && onLoadMore ? (
                        <span className="text-xs text-destructive">{errorMessage}</span>
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
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
                    className="flex items-center border-b text-sm hover:bg-accent/50"
                  >
                    <div className="flex-[1] min-w-[150px] px-3 font-mono text-xs text-muted-foreground">
                      {log.createdAt
                        ? formatInTimeZone(new Date(log.createdAt), timeZone, "yyyy-MM-dd HH:mm:ss")
                        : "-"}
                    </div>
                    <div className="flex-[2.2] min-w-[240px] px-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-sm">
                          {log.model ? <ModelVendorIcon modelId={log.model} /> : null}
                          {log.model ? (
                            <button
                              type="button"
                              className="max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left hover:underline"
                              onClick={() => handleCopyModel(log.model!)}
                            >
                              {log.model}
                            </button>
                          ) : (
                            <span>{t("unknownModel")}</span>
                          )}
                        </div>
                        {log.modelRedirect ? (
                          <div className="text-xs text-muted-foreground truncate">
                            {log.modelRedirect}
                          </div>
                        ) : null}
                        {log.billingModel && log.billingModel !== log.model ? (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {t("billingModel", { model: log.billingModel })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex-[0.9] min-w-[100px] px-2 text-right text-xs font-mono tabular-nums">
                      <div className="flex flex-col items-end leading-tight">
                        <span>{formatTokenAmount(log.inputTokens)}</span>
                        <span className="text-muted-foreground">
                          {formatTokenAmount(log.outputTokens)}
                        </span>
                      </div>
                    </div>
                    <div className="flex-[1] min-w-[120px] px-2 text-right font-mono text-xs">
                      <TooltipProvider>
                        <Tooltip delayDuration={250}>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 w-full cursor-help">
                              {log.cacheCreationInputTokens &&
                              log.cacheCreationInputTokens > 0 &&
                              log.cacheTtlApplied ? (
                                <Badge variant="outline" className="text-[10px] leading-tight px-1">
                                  {log.cacheTtlApplied}
                                </Badge>
                              ) : null}
                              <span className="ml-auto">
                                {formatTokenAmount(log.cacheCreationInputTokens)}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent align="end" className="text-xs space-y-1">
                            <div>5m: {formatTokenAmount(log.cacheCreation5mInputTokens)}</div>
                            <div>1h: {formatTokenAmount(log.cacheCreation1hInputTokens)}</div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex-[0.8] min-w-[90px] px-2 text-right font-mono text-xs">
                      {formatTokenAmount(log.cacheReadInputTokens)}
                    </div>
                    <div className="flex-[0.8] min-w-[90px] px-2 text-right text-sm font-mono">
                      {CURRENCY_CONFIG[currencyCode]?.symbol ?? currencyCode}
                      {Number(log.cost ?? 0).toFixed(4)}
                    </div>
                    <div className="flex-[0.7] min-w-[80px] px-3">
                      <Badge
                        variant={
                          log.statusCode && log.statusCode >= 400 ? "destructive" : "outline"
                        }
                        className={
                          log.statusCode === 200
                            ? "border-green-500 text-green-600 dark:text-green-400"
                            : undefined
                        }
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

      {showScrollToTop ? (
        <Button className="fixed bottom-8 right-8 shadow-lg z-50" onClick={scrollToTop}>
          <ArrowUp className="h-4 w-4 mr-1" />
          {tDashboard("logs.table.scrollToTop")}
        </Button>
      ) : null}
    </div>
  );
}
