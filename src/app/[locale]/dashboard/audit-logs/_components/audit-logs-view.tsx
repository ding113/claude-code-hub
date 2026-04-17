"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { getAuditLogsBatch } from "@/actions/audit-logs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVirtualizedInfiniteList } from "@/hooks/use-virtualized-infinite-list";
import { cn } from "@/lib/utils";
import type { AuditCategory, AuditLogRow } from "@/types/audit-log";
import { IpDetailsDialog } from "../../_components/ip-details-dialog";
import { AuditLogDetailSheet } from "./audit-log-detail-sheet";

const BATCH_SIZE = 50;
const ROW_HEIGHT = 56;

const CATEGORIES: AuditCategory[] = [
  "auth",
  "user",
  "provider",
  "provider_group",
  "system_settings",
  "key",
  "notification",
  "sensitive_word",
  "model_price",
];

type StatusFilter = "all" | "success" | "failure";

export function AuditLogsView() {
  const t = useTranslations("auditLogs");

  const [category, setCategory] = useState<AuditCategory | "">("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedLog, setSelectedLog] = useState<AuditLogRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const [ipDialogValue, setIpDialogValue] = useState<string | null>(null);

  const filter = useMemo(() => {
    const f: {
      category?: string;
      success?: boolean;
    } = {};
    if (category) f.category = category;
    if (status === "success") f.success = true;
    if (status === "failure") f.success = false;
    return f;
  }, [category, status]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteQuery({
      queryKey: ["audit-logs-batch", filter],
      queryFn: async ({ pageParam }) => {
        const result = await getAuditLogsBatch({
          filter,
          cursor: pageParam ?? null,
          pageSize: BATCH_SIZE,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        return result.data;
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialPageParam: undefined as { createdAt: string; id: number } | undefined,
      staleTime: 15000,
      refetchOnWindowFocus: false,
    });

  const pages = data?.pages;
  const rows = useMemo(() => pages?.flatMap((page) => page.rows) ?? [], [pages]);

  const getItemKey = useCallback((index: number) => rows[index]?.id ?? `loader-${index}`, [rows]);

  const { parentRef, rowVirtualizer, virtualItems, handleScroll } = useVirtualizedInfiniteList({
    itemCount: rows.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey,
  });

  const openDetail = (log: AuditLogRow) => {
    setSelectedLog(log);
    setDetailOpen(true);
  };

  const openIp = (ip: string) => {
    setIpDialogValue(ip);
    setIpDialogOpen(true);
  };

  const categoryLabel = (cat: string) => {
    const key = `categories.${cat}` as const;
    try {
      return t(key);
    } catch {
      return cat;
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("filters.category")}</span>
          <Select
            value={category === "" ? "__all__" : category}
            onValueChange={(value) =>
              setCategory(value === "__all__" ? "" : (value as AuditCategory))
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("filters.allCategories")}</SelectItem>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {categoryLabel(cat)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("filters.success")}</span>
          <div className="flex gap-1">
            {(["all", "success", "failure"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={status === option ? "default" : "outline"}
                size="sm"
                onClick={() => setStatus(option)}
              >
                {option === "all"
                  ? t("filters.all")
                  : option === "success"
                    ? t("filters.succeeded")
                    : t("filters.failed")}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        {/* Header */}
        <div className="bg-muted/30 border-b sticky top-0 z-10">
          <div className="flex items-center h-9 text-xs font-medium text-muted-foreground/80 tracking-wide">
            <div className="flex-[0.8] min-w-[110px] pl-3 truncate">{t("columns.time")}</div>
            <div className="flex-[0.7] min-w-[90px] px-1.5 truncate">{t("columns.category")}</div>
            <div className="flex-[1.2] min-w-[140px] px-1.5 truncate">{t("columns.action")}</div>
            <div className="flex-[0.9] min-w-[110px] px-1.5 truncate">{t("columns.operator")}</div>
            <div className="flex-[0.9] min-w-[120px] px-1.5 truncate">{t("columns.ip")}</div>
            <div className="flex-[1.2] min-w-[160px] px-1.5 truncate">{t("columns.target")}</div>
            <div className="flex-[0.5] min-w-[70px] pr-3 truncate">{t("columns.status")}</div>
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="text-center py-8 text-destructive">
            {error instanceof Error ? error.message : "Error"}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">{t("empty")}</div>
        ) : (
          <div ref={parentRef} className="h-[600px] overflow-auto" onScroll={handleScroll}>
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((virtualRow) => {
                const isLoaderRow = virtualRow.index >= rows.length;
                const log = rows[virtualRow.index];

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

                const operator = log.operatorUserName ?? "Admin Token";

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
                      "flex items-center text-sm border-b border-border/40 transition-colors hover:bg-accent/50 cursor-pointer"
                    )}
                    onClick={() => openDetail(log)}
                  >
                    <div className="flex-[0.8] min-w-[110px] font-mono text-xs pl-3 truncate">
                      <RelativeTime date={log.createdAt} fallback="-" format="short" />
                    </div>
                    <div className="flex-[0.7] min-w-[90px] px-1.5 truncate">
                      <Badge variant="outline" className="text-[10px]">
                        {categoryLabel(log.actionCategory)}
                      </Badge>
                    </div>
                    <div
                      className="flex-[1.2] min-w-[140px] font-mono text-xs px-1.5 truncate"
                      title={log.actionType}
                    >
                      {log.actionType}
                    </div>
                    <div className="flex-[0.9] min-w-[110px] px-1.5 truncate" title={operator}>
                      {operator}
                    </div>
                    <div className="flex-[0.9] min-w-[120px] px-1.5 truncate">
                      {log.operatorIp ? (
                        <button
                          type="button"
                          className="font-mono text-xs underline decoration-dotted hover:decoration-solid"
                          onClick={(event) => {
                            event.stopPropagation();
                            openIp(log.operatorIp as string);
                          }}
                        >
                          {log.operatorIp}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </div>
                    <div
                      className="flex-[1.2] min-w-[160px] px-1.5 truncate"
                      title={log.targetName ?? log.targetType ?? ""}
                    >
                      <div className="flex flex-col leading-tight">
                        {log.targetType && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate">
                            {log.targetType}
                          </span>
                        )}
                        <span className="text-xs truncate">{log.targetName ?? "—"}</span>
                      </div>
                    </div>
                    <div className="flex-[0.5] min-w-[70px] pr-3">
                      {log.success ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800"
                        >
                          {t("filters.succeeded")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800"
                        >
                          {t("filters.failed")}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <AuditLogDetailSheet log={selectedLog} open={detailOpen} onOpenChange={setDetailOpen} />
      <IpDetailsDialog ip={ipDialogValue} open={ipDialogOpen} onOpenChange={setIpDialogOpen} />
    </div>
  );
}
