"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "@/i18n/routing";
import { getAllSessions } from "@/actions/active-sessions";
import { ActiveSessionsTable } from "./_components/active-sessions-table";
import type { ActiveSessionInfo } from "@/types/session";
import type { CurrencyCode } from "@/lib/utils/currency";
import { useTranslations } from "next-intl";
import { useWebSocket } from "@/hooks/use-websocket";
import { ConnectionStatus } from "@/components/ui/connection-status";

const REFRESH_INTERVAL = 3000; // 3秒刷新一次（轮询降级使用）

async function fetchAllSessions(): Promise<{
  active: ActiveSessionInfo[];
  inactive: ActiveSessionInfo[];
}> {
  const result = await getAllSessions();
  if (!result.ok) {
    // Error message will be handled by React Query
    throw new Error(result.error || "FETCH_SESSIONS_FAILED");
  }
  return result.data;
}

async function fetchSystemSettings(): Promise<{ currencyDisplay: CurrencyCode }> {
  const response = await fetch("/api/system-settings");
  if (!response.ok) {
    throw new Error("FETCH_SETTINGS_FAILED");
  }
  return response.json();
}

/**
 * 活跃 Session 实时监控页面
 */
export default function ActiveSessionsPage() {
  const router = useRouter();
  const t = useTranslations("dashboard.sessions");

  // WebSocket 实时数据推送
  const {
    data: wsData,
    connectionState,
    connectionType,
    error: wsError,
  } = useWebSocket<{ active: ActiveSessionInfo[]; inactive: ActiveSessionInfo[] }>(
    "sessions",
    "all-sessions-update"
  );

  // 轮询降级方案（WebSocket 不可用时启用）
  const {
    data: pollingData,
    isLoading,
    error: pollingError,
  } = useQuery<{ active: ActiveSessionInfo[]; inactive: ActiveSessionInfo[] }, Error>({
    queryKey: ["all-sessions"],
    queryFn: fetchAllSessions,
    refetchInterval: REFRESH_INTERVAL,
    enabled: connectionType === "polling", // 仅当降级到轮询时才启用
  });

  const { data: systemSettings } = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
  });

  // 合并数据源（优先使用 WebSocket 数据）
  const data = wsData || pollingData;
  const error = wsError || pollingError;

  const activeSessions = data?.active || [];
  const inactiveSessions = data?.inactive || [];
  const currencyCode = systemSettings?.currencyDisplay || "USD";

  // Translate error messages
  const getErrorMessage = (error: Error): string => {
    if (error.message === "FETCH_SESSIONS_FAILED") {
      return t("errors.fetchSessionsFailed");
    }
    if (error.message === "FETCH_SETTINGS_FAILED") {
      return t("errors.fetchSettingsFailed");
    }
    return error.message;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("back")}
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{t("monitoring")}</h1>
          <p className="text-sm text-muted-foreground">{t("monitoringDescription")}</p>
        </div>
        {/* 连接状态指示器 */}
        <ConnectionStatus
          connectionState={connectionState}
          connectionType={connectionType}
          error={wsError}
          showDetails
        />
      </div>

      {error ? (
        <div className="text-center text-destructive py-8">
          {t("loadingError")}: {getErrorMessage(error)}
        </div>
      ) : (
        <>
          {/* 活跃 Session 区域 */}
          <Section title={t("activeSessions")}>
            <ActiveSessionsTable
              sessions={activeSessions}
              isLoading={isLoading}
              currencyCode={currencyCode}
            />
          </Section>

          {/* 非活跃 Session 区域 */}
          {inactiveSessions.length > 0 && (
            <Section title={t("inactiveSessions")}>
              <ActiveSessionsTable
                sessions={inactiveSessions}
                isLoading={isLoading}
                inactive
                currencyCode={currencyCode}
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
