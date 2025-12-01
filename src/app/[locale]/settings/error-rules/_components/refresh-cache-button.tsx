"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { refreshCacheAction } from "@/actions/error-rules";
import { Button } from "@/components/ui/button";

interface RefreshCacheButtonProps {
  stats: {
    regexCount: number;
    containsCount: number;
    exactCount: number;
    totalCount: number;
    lastReloadTime: number;
    isLoading: boolean;
  } | null;
}

export function RefreshCacheButton({ stats }: RefreshCacheButtonProps) {
  const t = useTranslations("settings");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      const result = await refreshCacheAction();

      if (result.ok) {
        const count = result.data.stats.totalCount;
        toast.success(t("errorRules.refreshCacheSuccess", { count }));
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("errorRules.refreshCacheFailed"));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleRefresh}
      disabled={isRefreshing}
      title={
        stats
          ? t("errorRules.cacheStats", {
              totalCount: stats.totalCount,
            })
          : t("errorRules.refreshCache")
      }
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      {t("errorRules.refreshCache")}
      {stats && <span className="ml-2 text-xs text-muted-foreground">({stats.totalCount})</span>}
    </Button>
  );
}
