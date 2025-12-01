"use client";

import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
}: ActiveSessionsTableProps) {
  const t = useTranslations("dashboard.sessions");

  // 按开始时间降序排序（最新的在前）
  const sortedSessions = [...sessions].sort((a, b) => b.startTime - a.startTime);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t("table.count", {
            count: sessions.length,
            type: t(inactive ? "table.inactive" : "table.active"),
          })}
          {inactive && <span className="ml-2 text-xs">{t("table.notCountedInConcurrency")}</span>}
        </div>
        {isLoading && (
          <div className="text-sm text-muted-foreground animate-pulse">{t("table.refreshing")}</div>
        )}
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
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  {t("table.noActiveSessions")}
                </TableCell>
              </TableRow>
            ) : (
              sortedSessions.map((session) => (
                <TableRow key={session.sessionId}>
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
                    <Link href={`/dashboard/sessions/${session.sessionId}/messages`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        {t("actions.view")}
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
