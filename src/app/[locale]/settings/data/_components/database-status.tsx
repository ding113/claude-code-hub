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
        // Check 503 before parsing JSON (response may not have JSON body)
        if (response.status === 503) {
          throw new Error(t("connectionUnavailable"));
        }
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
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] border border-destructive/20 p-4">
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
    <div className="space-y-4">
      {/* Status header with badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {status.isAvailable ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border bg-green-500/10 text-green-400 border-green-500/20">
              {t("connected")}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border bg-orange-500/10 text-orange-400 border-orange-500/20">
              {t("unavailable")}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchStatus} className="h-8">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Glass cards for stats */}
      {status.isAvailable && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Database className="h-4 w-4" />
              <span>{t("size")}</span>
            </div>
            <p className="text-lg font-mono font-bold text-foreground">{status.databaseSize}</p>
          </div>
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Table className="h-4 w-4" />
              <span>{t("tableCount")}</span>
            </div>
            <p className="text-lg font-mono font-bold text-foreground">{status.tableCount}</p>
          </div>
        </div>
      )}

      {/* Error message */}
      {status.error && (
        <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 p-3 text-sm text-orange-400">
          {status.isAvailable === false ? t("connectionUnavailable") : status.error}
        </div>
      )}
    </div>
  );
}
