"use client";

import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle,
  Loader2,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getSessionRequests } from "@/actions/active-sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  className?: string;
}

export function RequestListSidebar({
  sessionId,
  selectedSeq,
  onSelect,
  collapsed = false,
  className,
}: RequestListSidebarProps) {
  const t = useTranslations("dashboard.sessions");
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const pageSize = 20;

  const fetchRequests = useCallback(
    async (pageNum: number, sortOrder: "asc" | "desc") => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getSessionRequests(sessionId, pageNum, pageSize, sortOrder);
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
    void fetchRequests(page, order);
  }, [fetchRequests, page, order]);

  // Formatter functions
  const formatTime = (date: Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const getStatusColor = (statusCode: number | null) => {
    if (!statusCode) return "text-muted-foreground";
    if (statusCode >= 200 && statusCode < 300) return "text-emerald-600 dark:text-emerald-500";
    if (statusCode >= 400 && statusCode < 500) return "text-amber-600 dark:text-amber-500";
    return "text-destructive";
  };

  const getStatusIcon = (statusCode: number | null) => {
    if (!statusCode) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
    if (statusCode >= 200 && statusCode < 300)
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />;
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  };

  // Minimized View
  if (collapsed) {
    return (
      <div className={cn("flex flex-col items-center py-4 border-r bg-muted/10 h-full", className)}>
        <div className="flex flex-col gap-4 w-full px-2">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-8 rounded-full" />
              ))
            : requests.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => onSelect(req.sequence)}
                  className={cn(
                    "relative flex items-center justify-center w-8 h-8 rounded-full transition-all",
                    selectedSeq === req.sequence
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "hover:bg-muted"
                  )}
                  title={`#${req.sequence} - ${req.model || "Unknown"}`}
                >
                  <span className="text-xs font-mono">{req.sequence}</span>
                  <span className="absolute -top-1 -right-1">
                    {/* Tiny status dot */}
                    <span
                      className={cn(
                        "flex h-2 w-2 rounded-full",
                        req.statusCode && req.statusCode >= 200 && req.statusCode < 300
                          ? "bg-emerald-500"
                          : !req.statusCode
                            ? "bg-gray-400"
                            : "bg-destructive"
                      )}
                    />
                  </span>
                </button>
              ))}
        </div>
      </div>
    );
  }

  // Expanded View
  return (
    <div
      className={cn("flex flex-col h-full bg-background/50 backdrop-blur-sm border-r", className)}
    >
      {/* Header */}
      <div className="p-4 border-b flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold tracking-tight">{t("requestList.title")}</h3>
          <Badge variant="outline" className="text-xs font-mono">
            {total}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Placeholder for future search - currently just visual */}
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="h-7 text-xs pl-7 bg-muted/20 border-muted-foreground/20"
              disabled
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
            title={order === "asc" ? t("requestList.orderDesc") : t("requestList.orderAsc")}
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading && requests.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 text-center p-4">
            <AlertCircle className="h-8 w-8 text-destructive mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center p-4">
            <MoreHorizontal className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground">{t("requestList.noRequests")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {requests.map((request) => (
              <button
                key={request.id}
                type="button"
                className={cn(
                  "w-full px-4 py-3 text-left transition-all hover:bg-muted/50 group relative",
                  selectedSeq === request.sequence && "bg-muted/60 hover:bg-muted/70"
                )}
                onClick={() => onSelect(request.sequence)}
              >
                {/* Active Indicator */}
                {selectedSeq === request.sequence && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                )}

                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-mono font-medium px-1.5 py-0.5 rounded-md bg-muted",
                        selectedSeq === request.sequence ? "bg-background shadow-sm" : ""
                      )}
                    >
                      #{request.sequence}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-medium truncate max-w-[120px]",
                        !request.model && "text-muted-foreground italic"
                      )}
                    >
                      {request.model || "Unknown Model"}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatTime(request.createdAt)}
                  </span>
                </div>

                <div className="flex justify-between items-center mt-2">
                  <div className="flex items-center gap-1.5">
                    {getStatusIcon(request.statusCode)}
                    <span className={cn("text-xs font-mono", getStatusColor(request.statusCode))}>
                      {request.statusCode || "---"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {request.costUsd && <span>${Number(request.costUsd).toFixed(6)}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="p-3 border-t bg-muted/10 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={page === 1 || isLoading}
            onClick={() => setPage((p) => p - 1)}
          >
            <span className="sr-only">{t("requestList.prev")}</span>
            <span className="text-xs">←</span>
          </Button>
          <span className="text-xs text-muted-foreground font-mono">
            {page} / {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={!hasMore || isLoading}
            onClick={() => setPage((p) => p + 1)}
          >
            <span className="sr-only">{t("requestList.next")}</span>
            <span className="text-xs">→</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
