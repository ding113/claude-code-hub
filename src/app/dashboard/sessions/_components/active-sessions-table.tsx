"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ActiveSessionInfo } from "@/types/session";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";

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
  // 按开始时间降序排序（最新的在前）
  const sortedSessions = [...sessions].sort((a, b) => b.startTime - a.startTime);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          共 {sessions.length} 个{inactive ? "非活跃" : "活跃"} Session
          {inactive && <span className="ml-2 text-xs">(不计入并发数)</span>}
        </div>
        {isLoading && <div className="text-sm text-muted-foreground animate-pulse">刷新中...</div>}
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
              <TableHead>Session ID</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>密钥</TableHead>
              <TableHead>供应商</TableHead>
              <TableHead>模型</TableHead>
              <TableHead className="text-center">请求数</TableHead>
              <TableHead className="text-right">总输入</TableHead>
              <TableHead className="text-right">总输出</TableHead>
              <TableHead className="text-right">总成本</TableHead>
              <TableHead className="text-right">总耗时</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  暂无活跃 Session
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
                        查看
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
