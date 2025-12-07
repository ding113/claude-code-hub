"use client";

import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getSessionRequests } from "@/actions/active-sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface RequestItem {
  id: number;
  sequence: number;
  model: string | null;
  statusCode: number | null;
  costUsd: string | null;
  createdAt: Date | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
}

interface RequestListSidebarProps {
  sessionId: string;
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * Request List Sidebar - Session 内请求列表侧边栏
 * 显示 Session 中所有请求，支持分页和选择
 */
export function RequestListSidebar({
  sessionId,
  selectedSeq,
  onSelect,
  collapsed = false,
  onCollapsedChange,
}: RequestListSidebarProps) {
  const t = useTranslations("dashboard.sessions");
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 20;

  const fetchRequests = useCallback(
    async (pageNum: number) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getSessionRequests(sessionId, pageNum, pageSize);
        if (result.ok) {
          setRequests(result.data.requests);
          setTotal(result.data.total);
          setHasMore(result.data.hasMore);
        } else {
          setError(result.error || t("requestList.fetchFailed"));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("requestList.unknownError"));
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, t]
  );

  useEffect(() => {
    void fetchRequests(page);
  }, [fetchRequests, page]);

  // 格式化相对时间
  const formatRelativeTime = (date: Date | null) => {
    if (!date) return "-";
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return "<1m";
  };

  // 获取状态图标
  const getStatusIcon = (statusCode: number | null) => {
    if (!statusCode) {
      return <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />;
    }
    if (statusCode >= 200 && statusCode < 300) {
      return <CheckCircle className="h-3 w-3 text-green-600" />;
    }
    return <AlertCircle className="h-3 w-3 text-destructive" />;
  };

  // 折叠时只显示切换按钮
  if (collapsed) {
    return (
      <div className="w-10 border-r bg-muted/30 flex flex-col items-center py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onCollapsedChange?.(false)}
          aria-label={t("requestList.title")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {total > 0 && (
          <Badge variant="secondary" className="mt-2 text-xs px-1.5">
            {total}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t("requestList.title")}</h3>
          {total > 0 && (
            <Badge variant="secondary" className="text-xs">
              {total}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onCollapsedChange?.(true)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Request List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {isLoading && requests.length === 0 ? (
            // Loading skeleton
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-2 rounded-md">
                <Skeleton className="h-4 w-16 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))
          ) : error ? (
            <div className="p-4 text-center text-sm text-destructive">{error}</div>
          ) : requests.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t("requestList.noRequests")}
            </div>
          ) : (
            requests.map((request) => (
              <button
                key={request.id}
                type="button"
                className={cn(
                  "w-full p-2 rounded-md text-left transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  selectedSeq === request.sequence && "bg-accent text-accent-foreground"
                )}
                onClick={() => onSelect(request.sequence)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {getStatusIcon(request.statusCode)}
                    <span className="text-sm font-medium">#{request.sequence}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(request.createdAt)}
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">
                    {request.model || "-"}
                  </span>
                  {request.statusCode && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1 py-0",
                        request.statusCode >= 200 && request.statusCode < 300
                          ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                          : "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                      )}
                    >
                      {request.statusCode}
                    </Badge>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="p-2 border-t flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={page === 1 || isLoading}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("requestList.prev")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {page}/{Math.ceil(total / pageSize)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={!hasMore || isLoading}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("requestList.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
