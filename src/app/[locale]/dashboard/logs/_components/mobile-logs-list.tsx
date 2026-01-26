"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getUsageLogsBatch } from "@/actions/usage-logs";
import { Button } from "@/components/ui/button";
import { useVirtualizer } from "@/hooks/use-virtualizer";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderChainItem } from "@/types/message";
import type { SpecialSetting } from "@/types/special-settings";
import type { BillingModelSource } from "@/types/system-config";
import { ErrorDetailsDialog } from "./error-details-dialog";
import { MobileLogCard } from "./mobile-log-card";
import type { VirtualizedLogsTableFilters } from "./virtualized-logs-table";

const BATCH_SIZE = 50;
const CARD_HEIGHT = 160;
const CARD_GAP = 12;

interface MobileLogsListProps {
  filters: VirtualizedLogsTableFilters;
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
  autoRefreshEnabled?: boolean;
  autoRefreshIntervalMs?: number;
  hideStatusBar?: boolean;
  hideScrollToTop?: boolean;
  bodyClassName?: string;
}

interface LogItem {
  id: number;
  createdAt: Date;
  statusCode: number | null;
  errorMessage: string | null;
  userName: string;
  keyName: string;
  sessionId: string | null;
  requestSequence: number | null;
  providerName: string | null;
  providerChain: ProviderChainItem[] | null;
  model: string | null;
  originalModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheTtlApplied: string | null;
  costUsd: string | null;
  costMultiplier: string | null;
  context1mApplied: boolean | null;
  durationMs: number | null;
  ttfbMs: number | null;
  endpoint: string | null;
  blockedBy: string | null;
  blockedReason: string | null;
  userAgent: string | null;
  messagesCount: number | null;
  specialSettings: SpecialSetting[] | null;
}

export function MobileLogsList({
  filters,
  currencyCode = "USD",
  billingModelSource = "original",
  autoRefreshEnabled = true,
  autoRefreshIntervalMs = 5000,
  hideStatusBar = false,
  hideScrollToTop = false,
  bodyClassName,
}: MobileLogsListProps) {
  const t = useTranslations("dashboard");
  const parentRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);

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
      staleTime: 30000,
      refetchOnWindowFocus: false,
      refetchInterval: autoRefreshEnabled ? autoRefreshIntervalMs : false,
    });

  const allLogs = (data?.pages.flatMap((page) => page.logs) ?? []) as LogItem[];

  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? allLogs.length + 1 : allLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + CARD_GAP,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (lastItemIndex >= allLogs.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [lastItemIndex, hasNextPage, isFetchingNextPage, allLogs.length, fetchNextPage]);

  const handleScroll = useCallback(() => {
    if (parentRef.current) {
      setShowScrollToTop(parentRef.current.scrollTop > 500);
    }
  }, []);

  const scrollToTop = useCallback(() => {
    parentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is an intentional trigger
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
    <div className="-mx-5 space-y-4">
      {!hideStatusBar && (
        <div className="flex items-center justify-between text-sm text-muted-foreground px-5">
          <span>{t("logs.table.loadedCount", { count: allLogs.length })}</span>
          {isFetchingNextPage && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("logs.table.loadingMore")}
            </span>
          )}
          {!hasNextPage && allLogs.length > 0 && <span>{t("logs.table.noMoreData")}</span>}
        </div>
      )}

      <div
        ref={parentRef}
        className={bodyClassName || "h-[calc(100vh-200px)] overflow-auto"}
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
                  height: `${virtualRow.size - CARD_GAP}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <MobileLogCard
                  log={log}
                  currencyCode={currencyCode}
                  billingModelSource={billingModelSource}
                  onClick={() => setSelectedLog(log)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {!hideScrollToTop && showScrollToTop && (
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

      {selectedLog && (
        <ErrorDetailsDialog
          statusCode={selectedLog.statusCode}
          errorMessage={selectedLog.errorMessage}
          providerChain={selectedLog.providerChain}
          sessionId={selectedLog.sessionId}
          requestSequence={selectedLog.requestSequence}
          blockedBy={selectedLog.blockedBy}
          blockedReason={selectedLog.blockedReason}
          originalModel={selectedLog.originalModel}
          currentModel={selectedLog.model}
          userAgent={selectedLog.userAgent}
          messagesCount={selectedLog.messagesCount}
          endpoint={selectedLog.endpoint}
          billingModelSource={billingModelSource}
          specialSettings={selectedLog.specialSettings}
          inputTokens={selectedLog.inputTokens}
          outputTokens={selectedLog.outputTokens}
          cacheCreationInputTokens={selectedLog.cacheCreationInputTokens}
          cacheCreation5mInputTokens={selectedLog.cacheCreation5mInputTokens}
          cacheCreation1hInputTokens={selectedLog.cacheCreation1hInputTokens}
          cacheReadInputTokens={selectedLog.cacheReadInputTokens}
          cacheTtlApplied={selectedLog.cacheTtlApplied}
          costUsd={selectedLog.costUsd}
          costMultiplier={selectedLog.costMultiplier}
          context1mApplied={selectedLog.context1mApplied}
          durationMs={selectedLog.durationMs}
          ttfbMs={selectedLog.ttfbMs}
          externalOpen={true}
          onExternalOpenChange={(open) => {
            if (!open) setSelectedLog(null);
          }}
        />
      )}
    </div>
  );
}
