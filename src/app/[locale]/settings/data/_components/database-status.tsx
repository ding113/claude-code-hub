"use client";

import { AlertCircle, Database, RefreshCw, Table } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DatabaseStatus } from "@/types/database-backup";

export function DatabaseStatusDisplay() {
  const t = useTranslations("settings.data.status");
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/database/status", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t("error"));
      }

      const data: DatabaseStatus = await response.json();
      setStatus(data);
    } catch (err) {
      console.error("Fetch status error:", err);
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <div className="flex-1">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Compact horizontal status bar */}
      <div className="flex items-center gap-6 rounded-lg border border-border bg-muted/30 px-4 py-3">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          {status.isAvailable ? (
            <>
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium">{t("connected")}</span>
            </>
          ) : (
            <>
              <div className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
              <span className="text-sm font-medium text-orange-500">{t("unavailable")}</span>
            </>
          )}
        </div>

        {/* Separator */}
        {status.isAvailable && (
          <>
            <div className="h-4 w-px bg-border" />

            {/* Database size */}
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{status.databaseSize}</span>
            </div>

            {/* Separator */}
            <div className="h-4 w-px bg-border" />

            {/* Table count */}
            <div className="flex items-center gap-2">
              <Table className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {t("tables", { count: status.tableCount })}
              </span>
            </div>
          </>
        )}

        {/* Refresh button */}
        <Button variant="ghost" size="sm" onClick={fetchStatus} className="ml-auto h-8">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 错误信息 */}
      {status.error && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
          {status.error}
        </div>
      )}
    </div>
  );
}
