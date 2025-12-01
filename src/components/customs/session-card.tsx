"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/routing";
import { cn, formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";

interface SessionCardProps {
  session: ActiveSessionInfo;
  className?: string;
  currencyCode?: CurrencyCode;
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
 * 获取状态Badge配置
 */
// Status badge config helper (labels translated inside component)
function getStatusConfig(
  status: "in_progress" | "completed" | "error",
  statusCode?: number,
  labels?: { inProgress: string; error: string; completed: string }
) {
  if (status === "in_progress") {
    return {
      label: labels?.inProgress || "in_progress",
      variant: "default" as const,
      className: "bg-blue-500 hover:bg-blue-600",
    };
  } else if (status === "error" || (statusCode && statusCode >= 400)) {
    return {
      label: labels?.error || "error",
      variant: "destructive" as const,
      className: "",
    };
  } else {
    return {
      label: labels?.completed || "completed",
      variant: "outline" as const,
      className: "text-green-600 border-green-600",
    };
  }
}

/**
 * Session信息卡片
 * 用于概览面板的横向滚动展示
 */
export function SessionCard({ session, className, currencyCode = "USD" }: SessionCardProps) {
  const t = useTranslations("customs");
  const statusConfig = getStatusConfig(session.status, session.statusCode, {
    inProgress: t("sessions.status.inProgress"),
    error: t("sessions.status.error"),
    completed: t("sessions.status.completed"),
  });
  const inputTokensDisplay =
    session.inputTokens !== undefined ? formatTokenAmount(session.inputTokens) : null;
  const outputTokensDisplay =
    session.outputTokens !== undefined ? formatTokenAmount(session.outputTokens) : null;

  return (
    <Link href={`/dashboard/sessions/${session.sessionId}/messages`}>
      <Card
        className={cn(
          "w-[280px] flex-shrink-0 hover:border-primary transition-all duration-200 cursor-pointer group",
          "hover:shadow-md",
          className
        )}
      >
        <CardContent className="p-4 space-y-2.5">
          {/* 用户和密钥 */}
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" title={session.userName}>
                {session.userName}
              </div>
              <div
                className="text-xs text-muted-foreground truncate font-mono"
                title={session.keyName}
              >
                {session.keyName}
              </div>
            </div>
          </div>

          {/* 模型和供应商 */}
          <div className="flex items-center gap-1.5 text-xs">
            <Badge variant="secondary" className="truncate max-w-[120px] font-mono">
              {session.model || t("sessions.unknown")}
            </Badge>
            {session.providerName && (
              <span className="text-muted-foreground truncate flex-1">
                @ {session.providerName}
              </span>
            )}
          </div>

          {/* 状态和时长 */}
          <div className="flex items-center justify-between">
            <Badge variant={statusConfig.variant} className={statusConfig.className}>
              {statusConfig.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              {formatDuration(session.durationMs)}
            </span>
          </div>

          {/* Token和成本 */}
          <div className="flex items-center justify-between text-xs border-t pt-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              {inputTokensDisplay && <span className="font-mono">↑{inputTokensDisplay}</span>}
              {outputTokensDisplay && <span className="font-mono">↓{outputTokensDisplay}</span>}
            </div>
            {session.costUsd && (
              <span className="font-mono font-medium">
                {formatCurrency(session.costUsd, currencyCode, 4)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
