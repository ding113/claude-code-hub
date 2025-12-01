"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getActiveSessions } from "@/actions/active-sessions";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";
import { SessionListItem } from "./session-list-item";

const REFRESH_INTERVAL = 5000; // 5秒刷新一次

async function fetchActiveSessions(): Promise<ActiveSessionInfo[]> {
  const result = await getActiveSessions();
  if (!result.ok) {
    throw new Error(result.error || "获取活跃 Session 失败");
  }
  return result.data;
}

interface ActiveSessionsListProps {
  /** 货币代码 */
  currencyCode?: CurrencyCode;
  /** 最大显示数量，默认显示全部 */
  maxItems?: number;
  /** 是否显示标题栏 */
  showHeader?: boolean;
  /** 容器最大高度 */
  maxHeight?: string;
  /** 自定义类名 */
  className?: string;
}

/**
 * 活跃 Session 列表组件
 * 可复用组件，支持自定义最大显示数量
 *
 * 注意：计数始终显示实际的活跃 session 数量，而不是显示的数量
 */
export function ActiveSessionsList({
  currencyCode = "USD",
  maxItems,
  showHeader = true,
  maxHeight = "200px",
  className = "",
}: ActiveSessionsListProps) {
  const router = useRouter();
  const tu = useTranslations("ui");
  const tc = useTranslations("customs");

  const { data = [], isLoading } = useQuery<ActiveSessionInfo[], Error>({
    queryKey: ["active-sessions"],
    queryFn: fetchActiveSessions,
    refetchInterval: REFRESH_INTERVAL,
  });

  // 实际显示的 session 列表（限制数量）
  const displaySessions = maxItems ? data.slice(0, maxItems) : data;
  // 实际的活跃 session 总数（用于计数显示）
  const totalCount = data.length;

  return (
    <div className={`border rounded-lg bg-card ${className}`}>
      {showHeader && (
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">{tc("activeSessions.title")}</h3>
            <span className="text-xs text-muted-foreground">
              {tc("activeSessions.summary", { count: totalCount, minutes: 5 })}
            </span>
          </div>
          <button
            onClick={() => router.push("/dashboard/sessions")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {tc("activeSessions.viewAll")} →
          </button>
        </div>
      )}

      <div style={{ maxHeight }} className="overflow-y-auto">
        {isLoading && displaySessions.length === 0 ? (
          <div
            className="flex items-center justify-center text-muted-foreground text-sm"
            style={{ height: maxHeight }}
          >
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            {tu("common.loading")}
          </div>
        ) : displaySessions.length === 0 ? (
          <div
            className="flex items-center justify-center text-muted-foreground text-sm"
            style={{ height: maxHeight }}
          >
            {tc("activeSessions.empty")}
          </div>
        ) : (
          <div className="divide-y">
            {displaySessions.map((session) => (
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
  );
}
