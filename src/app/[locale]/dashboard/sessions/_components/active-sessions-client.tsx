"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/routing";
import { getSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import { fetchAllSessionsPage, type PaginatedSessionsData } from "./active-sessions-query";
import { ActiveSessionsTable } from "./active-sessions-table";

const REFRESH_INTERVAL = 3000; // 3秒刷新一次
const PAGE_SIZE = 20;

/**
 * 活跃 Session 实时监控页面
 */
export function ActiveSessionsClient() {
  const router = useRouter();
  const t = useTranslations("dashboard.sessions");

  // 分页状态
  const [activePage, setActivePage] = useState(1);
  const [inactivePage, setInactivePage] = useState(1);

  const { data, isLoading, isFetching, error, refetch } = useQuery<PaginatedSessionsData, Error>({
    queryKey: ["all-sessions", activePage, inactivePage],
    queryFn: ({ signal }) =>
      fetchAllSessionsPage({ activePage, inactivePage, pageSize: PAGE_SIZE, signal }),
    retry: false,
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: systemSettings } = useQuery({
    queryKey: ["system-settings"],
    queryFn: getSystemSettings,
  });

  const activeSessions = data?.active || [];
  const inactiveSessions = data?.inactive || [];
  const totalActive = data?.totalActive || 0;
  const totalInactive = data?.totalInactive || 0;
  const hasMoreActive = data?.hasMoreActive || false;
  const hasMoreInactive = data?.hasMoreInactive || false;
  const currencyCode = systemSettings?.currencyDisplay || "USD";

  // Translate error messages
  const getErrorMessage = (error: Error): string => {
    if (error.message === "FETCH_SESSIONS_FAILED") {
      return t("errors.fetchSessionsFailed");
    }
    if (error.message === "FETCH_SESSIONS_TIMEOUT") {
      return t("errors.fetchSessionsTimeout");
    }
    if (error.message === "FETCH_SETTINGS_FAILED") {
      return t("errors.fetchSettingsFailed");
    }
    return error.message;
  };

  // 分页控件组件
  const PaginationControls = ({
    page,
    setPage,
    total,
    hasMore,
    label,
  }: {
    page: number;
    setPage: (page: number) => void;
    total: number;
    hasMore: boolean;
    label: string;
  }) => {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <span>
          {label}: {total} {t("pagination.total")}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={!hasMore}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
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

      {error && !data ? (
        <div className="flex flex-col items-center gap-3 text-center text-destructive py-8">
          <p>
            {t("loadingError")}: {getErrorMessage(error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("errors.retry")}
          </Button>
        </div>
      ) : (
        <>
          {error ? (
            <div className="flex items-center justify-between gap-3 border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <p>
                {t("loadingError")}: {getErrorMessage(error)}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("errors.retry")}
              </Button>
            </div>
          ) : null}
          {/* 活跃 Session 区域 */}
          <Section title={t("activeSessions")}>
            {isFetching && !isLoading ? (
              <p className="mb-3 text-xs text-muted-foreground">{t("refreshing")}</p>
            ) : null}
            <ActiveSessionsTable
              sessions={activeSessions}
              isLoading={isLoading}
              currencyCode={currencyCode}
              onSessionTerminated={() => refetch()}
            />
            <PaginationControls
              page={activePage}
              setPage={setActivePage}
              total={totalActive}
              hasMore={hasMoreActive}
              label={t("activeSessions")}
            />
          </Section>

          {/* 非活跃 Session 区域 */}
          {(inactiveSessions.length > 0 || totalInactive > 0) && (
            <Section title={t("inactiveSessions")}>
              <ActiveSessionsTable
                sessions={inactiveSessions}
                isLoading={isLoading}
                inactive
                currencyCode={currencyCode}
              />
              <PaginationControls
                page={inactivePage}
                setPage={setInactivePage}
                total={totalInactive}
                hasMore={hasMoreInactive}
                label={t("inactiveSessions")}
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
