"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { getAllSessions } from "@/actions/active-sessions";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/routing";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ActiveSessionInfo } from "@/types/session";
import { ActiveSessionsTable } from "./_components/active-sessions-table";

const REFRESH_INTERVAL = 3000; // 3秒刷新一次

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

  const { data, isLoading, error } = useQuery<
    { active: ActiveSessionInfo[]; inactive: ActiveSessionInfo[] },
    Error
  >({
    queryKey: ["all-sessions"],
    queryFn: fetchAllSessions,
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: systemSettings } = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
  });

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
        <div>
          <h1 className="text-2xl font-bold">{t("monitoring")}</h1>
          <p className="text-sm text-muted-foreground">{t("monitoringDescription")}</p>
        </div>
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
