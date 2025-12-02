"use client";

import { CheckCircle, Clock, Cpu, Key, Loader2, User, XCircle } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cn, formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";

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
 * 可复用组件，用于活跃 Session 列表的单项展示
 */
export function SessionListItem({
  session,
  currencyCode = "USD",
}: {
  session: ActiveSessionInfo;
  currencyCode?: CurrencyCode;
}) {
  const statusInfo = getStatusIcon(session.status, session.statusCode);
  const StatusIcon = statusInfo.icon;
  const inputTokensDisplay =
    session.inputTokens !== undefined ? formatTokenAmount(session.inputTokens) : null;
  const outputTokensDisplay =
    session.outputTokens !== undefined ? formatTokenAmount(session.outputTokens) : null;

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
            title={`${session.model} @ ${session.providerName}`}
          >
            {session.model}
            {session.providerName && (
              <span className="text-muted-foreground"> @ {session.providerName}</span>
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
          {(inputTokensDisplay || outputTokensDisplay) && (
            <span className="text-muted-foreground">
              {inputTokensDisplay && `↑${inputTokensDisplay}`}
              {inputTokensDisplay && outputTokensDisplay && " "}
              {outputTokensDisplay && `↓${outputTokensDisplay}`}
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
