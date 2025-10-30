"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, User, Key, Cpu, Clock, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { getActiveSessions } from "@/actions/active-sessions";
import { cn } from "@/lib/utils";
import type { ActiveSessionInfo } from "@/types/session";
import Link from "next/link";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";

const REFRESH_INTERVAL = 5000; // 5秒刷新一次

async function fetchActiveSessions(): Promise<ActiveSessionInfo[]> {
  const result = await getActiveSessions();
  if (!result.ok) {
    throw new Error(result.error || "获取活跃 Session 失败");
  }
  return result.data;
}

/**
 * 格式化持续时长
 */
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

/**
 * 获取状态图标和颜色
 */
function getStatusIcon(status: "in_progress" | "completed" | "error", statusCode?: number) {
  if (status === "in_progress") {
    return { icon: Loader2, className: "text-blue-500 animate-spin" };
  } else if (status === "error" || (statusCode && statusCode >= 400)) {
    return { icon: XCircle, className: "text-red-500" };
  } else {
    return { icon: CheckCircle, className: "text-green-500" };
  }
}

/**
 * 简洁的 Session 列表项
 */
function SessionListItem({
  session,
  currencyCode = "USD",
  canViewProviderInfo = true,
}: {
  session: ActiveSessionInfo;
  currencyCode?: CurrencyCode;
  canViewProviderInfo?: boolean;
}) {
  const statusInfo = getStatusIcon(session.status, session.statusCode);
  const StatusIcon = statusInfo.icon;

  return (
    <Link
      href={`/dashboard/sessions/${session.sessionId}/messages`}
      className="block hover:bg-muted/50 transition-colors rounded-md px-3 py-2 group"
    >
      <div className="flex items-center gap-2 text-sm">
        {/* 状态图标 */}
        <StatusIcon className={cn("h-3.5 w-3.5 flex-shrink-0", statusInfo.className)} />

        {/* 用户信息 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="truncate font-medium max-w-[100px]" title={session.userName}>
            {session.userName}
          </span>
        </div>

        {/* 密钥 */}
        <div className="flex items-center gap-1 min-w-0">
          <Key className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span
            className="truncate text-muted-foreground text-xs font-mono max-w-[80px]"
            title={session.keyName}
          >
            {session.keyName}
          </span>
        </div>

        {/* 模型和供应商 */}
        <div className="flex items-center gap-1 min-w-0">
          <Cpu className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span
            className="truncate text-xs font-mono max-w-[120px]"
            title={
              canViewProviderInfo && session.providerName
                ? `${session.model} @ ${session.providerName}`
                : session.model || undefined
            }
          >
            {session.model}
            {canViewProviderInfo && session.providerName && (
              <span className="text-muted-foreground"> @ {session.providerName}</span>
            )}
            {!canViewProviderInfo && (
              <span className="text-muted-foreground"> @ ***</span>
            )}
          </span>
        </div>

        {/* 时长 */}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">
            {formatDuration(session.durationMs)}
          </span>
        </div>

        {/* Token 和成本 */}
        <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
          {(session.inputTokens !== undefined || session.outputTokens !== undefined) && (
            <span className="text-muted-foreground">
              {session.inputTokens !== undefined && `↑${session.inputTokens.toLocaleString()}`}
              {session.inputTokens !== undefined && session.outputTokens !== undefined && " "}
              {session.outputTokens !== undefined && `↓${session.outputTokens.toLocaleString()}`}
            </span>
          )}
          {session.costUsd && (
            <span className="font-medium">{formatCurrency(session.costUsd, currencyCode, 4)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * 活跃 Session 面板
 * 显示最近 5 分钟内的活跃 session 列表（简洁文字+图标形式）
 */
export function ActiveSessionsPanel({
  currencyCode = "USD",
  canViewProviderInfo = true,
}: {
  currencyCode?: CurrencyCode;
  canViewProviderInfo?: boolean;
}) {
  const router = useRouter();

  const { data = [], isLoading } = useQuery<ActiveSessionInfo[], Error>({
    queryKey: ["active-sessions"],
    queryFn: fetchActiveSessions,
    refetchInterval: REFRESH_INTERVAL,
  });

  return (
    <div className="border rounded-lg bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">活跃 Session</h3>
          <span className="text-xs text-muted-foreground">({data.length} 个活跃，最近 5 分钟)</span>
        </div>
        <button
          onClick={() => router.push("/dashboard/sessions")}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          查看全部 →
        </button>
      </div>

      <div className="max-h-[200px] overflow-y-auto">
        {isLoading && data.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            加载中...
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            暂无活跃 Session
          </div>
        ) : (
          <div className="divide-y">
            {data.map((session) => (
              <SessionListItem
                key={session.sessionId}
                session={session}
                currencyCode={currencyCode}
                canViewProviderInfo={canViewProviderInfo}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
