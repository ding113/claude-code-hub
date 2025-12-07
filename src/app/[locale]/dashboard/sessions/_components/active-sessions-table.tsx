"use client";

import { Eye, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { terminateActiveSession, terminateActiveSessionsBatch } from "@/actions/active-sessions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";

interface ActiveSessionsTableProps {
  sessions: ActiveSessionInfo[];
  isLoading: boolean;
  inactive?: boolean; // 标记是否为非活跃 session
  currencyCode?: CurrencyCode;
  onSessionTerminated?: () => void; // 终止后的回调
}

function formatDuration(durationMs: number | undefined): string {
  if (!durationMs) return "-";

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

export function ActiveSessionsTable({
  sessions,
  isLoading,
  inactive = false,
  currencyCode = "USD",
  onSessionTerminated,
}: ActiveSessionsTableProps) {
  const t = useTranslations("dashboard.sessions");
  const [sessionToTerminate, setSessionToTerminate] = useState<string | null>(null);
  const [isTerminatingSingle, setIsTerminatingSingle] = useState(false);
  const [isBatchTerminating, setIsBatchTerminating] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [terminatingSessionIds, setTerminatingSessionIds] = useState<Set<string>>(new Set());
  const showSelection = !inactive && isMultiSelectMode;

  // 使用 Set 优化成员检查性能
  const selectedIdsSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds]);

  // 按开始时间降序排序（最新的在前）
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.startTime - a.startTime),
    [sessions]
  );

  // 确保选中项始终存在于当前列表（排除正在终止的会话）
  useEffect(() => {
    setSelectedSessionIds((prev) =>
      prev.filter(
        (id) =>
          terminatingSessionIds.has(id) || sessions.some((session) => session.sessionId === id)
      )
    );
  }, [sessions, terminatingSessionIds]);

  const toggleSelection = (sessionId: string, checked: boolean) => {
    setSelectedSessionIds((prev) => {
      if (checked) {
        return selectedIdsSet.has(sessionId) ? prev : [...prev, sessionId];
      }
      return prev.filter((id) => id !== sessionId);
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedSessionIds([]);
      return;
    }
    setSelectedSessionIds(sortedSessions.map((session) => session.sessionId));
  };

  const handleTerminateSession = async (sessionId: string) => {
    setIsTerminatingSingle(true);
    try {
      const result = await terminateActiveSession(sessionId);
      if (result.ok) {
        toast.success(t("actions.terminateSuccess"));
        onSessionTerminated?.();
      } else {
        toast.error(result.error || t("actions.terminateFailed"));
      }
    } catch (_error) {
      toast.error(t("actions.terminateFailed"));
    } finally {
      setIsTerminatingSingle(false);
      setSessionToTerminate(null);
    }
  };

  const handleTerminateSelected = async () => {
    if (selectedSessionIds.length === 0) {
      toast.error(t("actions.noSelection"));
      return;
    }

    // 标记正在终止的会话
    setTerminatingSessionIds(new Set(selectedSessionIds));
    setIsBatchTerminating(true);
    try {
      const result = await terminateActiveSessionsBatch(selectedSessionIds);
      if (!result.ok) {
        toast.error(result.error || t("actions.terminateFailed"));
        return;
      }

      const summary = result.data;
      if (!summary) {
        toast.error(t("actions.terminateFailed"));
        return;
      }

      if (summary.successCount > 0) {
        toast.success(t("actions.batchTerminateSuccess", { count: summary.successCount }));
        onSessionTerminated?.();
      } else {
        toast.warning(t("actions.batchTerminateNone"));
      }

      if (summary.unauthorizedCount > 0 || summary.missingCount > 0) {
        toast.warning(
          t("actions.batchTerminatePartial", {
            unauthorized: summary.unauthorizedCount,
            missing: summary.missingCount,
          })
        );
      }

      if (summary.allowedFailedCount > 0) {
        toast.warning(
          t("actions.batchTerminateAllowedFailed", { count: summary.allowedFailedCount })
        );
      }

      setSelectedSessionIds([]);
    } catch (_error) {
      toast.error(t("actions.terminateFailed"));
    } finally {
      setIsBatchTerminating(false);
      setTerminatingSessionIds(new Set());
    }
  };

  // 切换多选模式
  const toggleMultiSelectMode = () => {
    if (isMultiSelectMode) {
      // 退出多选模式，清空选择
      setSelectedSessionIds([]);
      setIsMultiSelectMode(false);
    } else {
      // 进入多选模式
      setIsMultiSelectMode(true);
    }
  };

  const totalColumns = showSelection ? 12 : 11;
  const allSelected =
    showSelection &&
    selectedSessionIds.length > 0 &&
    selectedSessionIds.length === sortedSessions.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {t("table.count", {
            count: sessions.length,
            type: t(inactive ? "table.inactive" : "table.active"),
          })}
          {inactive && <span className="ml-2 text-xs">{t("table.notCountedInConcurrency")}</span>}
        </div>
        <div className="flex items-center gap-3">
          {isLoading && (
            <div className="text-sm text-muted-foreground animate-pulse">
              {t("table.refreshing")}
            </div>
          )}

          {/* 多选模式控制 */}
          {!inactive && (
            <div className="flex items-center gap-2">
              {isMultiSelectMode ? (
                <>
                  <span className="text-sm text-muted-foreground">
                    {t("actions.selectedCount", { count: selectedSessionIds.length })}
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleTerminateSelected}
                    disabled={isBatchTerminating || selectedSessionIds.length === 0}
                  >
                    {isBatchTerminating ? t("actions.terminating") : t("actions.terminateSelected")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={toggleMultiSelectMode}>
                    {t("actions.cancelMultiSelect")}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleMultiSelectMode}
                  disabled={sessions.length === 0}
                >
                  {t("actions.multiSelect")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "rounded-md border",
          inactive && "opacity-60" // 非活跃 session 半透明显示
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {showSelection && (
                <TableHead className="w-12">
                  <Checkbox
                    aria-label={t("actions.selectAll")}
                    checked={allSelected}
                    onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                    disabled={sortedSessions.length === 0 || isBatchTerminating}
                  />
                </TableHead>
              )}
              <TableHead>{t("columns.sessionId")}</TableHead>
              <TableHead>{t("columns.user")}</TableHead>
              <TableHead>{t("columns.key")}</TableHead>
              <TableHead>{t("columns.provider")}</TableHead>
              <TableHead>{t("columns.model")}</TableHead>
              <TableHead className="text-center">{t("columns.requestCount")}</TableHead>
              <TableHead className="text-right">{t("columns.totalInput")}</TableHead>
              <TableHead className="text-right">{t("columns.totalOutput")}</TableHead>
              <TableHead className="text-right">{t("columns.totalCost")}</TableHead>
              <TableHead className="text-right">{t("columns.totalDuration")}</TableHead>
              <TableHead className="text-center">{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColumns} className="text-center text-muted-foreground">
                  {t("table.noActiveSessions")}
                </TableCell>
              </TableRow>
            ) : (
              sortedSessions.map((session) => (
                <TableRow key={session.sessionId}>
                  {showSelection && (
                    <TableCell>
                      <Checkbox
                        aria-label={t("actions.selectSessionLabel")}
                        checked={selectedIdsSet.has(session.sessionId)}
                        onCheckedChange={(checked) =>
                          toggleSelection(session.sessionId, Boolean(checked))
                        }
                        disabled={isBatchTerminating}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs">
                    {session.sessionId.substring(0, 16)}...
                  </TableCell>
                  <TableCell>{session.userName}</TableCell>
                  <TableCell className="font-mono text-xs">{session.keyName}</TableCell>
                  <TableCell
                    className="max-w-[120px] truncate"
                    title={session.providerName || undefined}
                  >
                    {session.providerName || "-"}
                  </TableCell>
                  <TableCell
                    className="font-mono text-xs max-w-[150px] truncate"
                    title={session.model || undefined}
                  >
                    {session.model || "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="font-mono">
                      {session.requestCount || 1}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {session.inputTokens?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {session.outputTokens?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {session.costUsd ? formatCurrency(session.costUsd, currencyCode, 6) : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatDuration(session.durationMs)}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center gap-2 justify-center">
                      <Link href={`/dashboard/sessions/${session.sessionId}/messages`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4 mr-1" />
                          {t("actions.view")}
                        </Button>
                      </Link>
                      {!inactive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSessionToTerminate(session.sessionId)}
                          disabled={isTerminatingSingle}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          {t("actions.terminate")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 终止确认对话框 */}
      <AlertDialog
        open={!!sessionToTerminate}
        onOpenChange={(open) => {
          if (!open) {
            setSessionToTerminate(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.terminateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("actions.terminateDescription")}
              {sessionToTerminate && (
                <span className="font-mono text-sm mt-2 block">
                  {t("actions.sessionIdLabel", {
                    sessionId: `${sessionToTerminate.substring(0, 32)}...`,
                  })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTerminatingSingle}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => sessionToTerminate && handleTerminateSession(sessionToTerminate)}
              disabled={isTerminatingSingle}
            >
              {isTerminatingSingle ? t("actions.terminating") : t("actions.confirmTerminate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
