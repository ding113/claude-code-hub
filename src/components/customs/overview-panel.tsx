"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  TrendingUp,
  DollarSign,
  Clock,
  User,
  Key,
  Cpu,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { getOverviewData } from "@/actions/overview";
import { MetricCard } from "./metric-card";
import { formatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";
import type { OverviewData } from "@/actions/overview";
import type { ActiveSessionInfo } from "@/types/session";
import type { CurrencyCode } from "@/lib/utils";
import Link from "next/link";

const REFRESH_INTERVAL = 5000; // 5秒刷新一次

async function fetchOverviewData(): Promise<OverviewData> {
  const result = await getOverviewData();
  if (!result.ok) {
    throw new Error(result.error || "获取概览数据失败");
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
}: {
  session: ActiveSessionInfo;
  currencyCode?: CurrencyCode;
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

interface OverviewPanelProps {
  currencyCode?: CurrencyCode;
}

/**
 * 概览面板
 * 左侧：4个指标卡片
 * 右侧：简洁的活跃 Session 列表
 */
export function OverviewPanel({ currencyCode = "USD" }: OverviewPanelProps) {
  const router = useRouter();

  const { data, isLoading } = useQuery<OverviewData, Error>({
    queryKey: ["overview-data"],
    queryFn: fetchOverviewData,
    refetchInterval: REFRESH_INTERVAL,
  });

  // 格式化响应时间
  const formatResponseTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const metrics = data || {
    concurrentSessions: 0,
    todayRequests: 0,
    todayCost: 0,
    avgResponseTime: 0,
    recentSessions: [],
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full">
      {/* 左侧：指标卡片区域 */}
      <div className="lg:col-span-3">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            title="当前并发"
            value={metrics.concurrentSessions}
            description="最近 5 分钟"
            icon={Activity}
          />
          <MetricCard
            title="今日请求"
            value={metrics.todayRequests}
            description="API 调用次数"
            icon={TrendingUp}
          />
          <MetricCard
            title="今日消耗"
            value={formatCurrency(metrics.todayCost, currencyCode)}
            description="总费用"
            icon={DollarSign}
          />
          <MetricCard
            title="平均响应"
            value={metrics.avgResponseTime}
            description="响应时间"
            icon={Clock}
            formatter={formatResponseTime}
          />
        </div>
        <div className="mt-3">
          <button
            onClick={() => router.push("/dashboard/sessions")}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center py-1.5 hover:bg-muted rounded-md"
          >
            点击查看详情 →
          </button>
        </div>
      </div>

      {/* 右侧：活跃 Session 列表 */}
      <div className="lg:col-span-9">
        <div className="border rounded-lg bg-card">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">活跃 Session</h3>
              <span className="text-xs text-muted-foreground">
                ({metrics.recentSessions.length} 个活跃)
              </span>
            </div>
            <button
              onClick={() => router.push("/dashboard/sessions")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              查看全部 →
            </button>
          </div>

          <div className="max-h-[200px] overflow-y-auto">
            {isLoading && metrics.recentSessions.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                加载中...
              </div>
            ) : metrics.recentSessions.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                暂无活跃 Session
              </div>
            ) : (
              <div className="divide-y">
                {metrics.recentSessions.map((session) => (
                  <SessionListItem
                    key={session.sessionId}
                    session={session}
                    currencyCode={currencyCode}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
