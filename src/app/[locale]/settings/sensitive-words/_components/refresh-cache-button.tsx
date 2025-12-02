"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { refreshCacheAction } from "@/actions/sensitive-words";
import { Button } from "@/components/ui/button";

interface RefreshCacheButtonProps {
  stats: {
    containsCount: number;
    exactCount: number;
    regexCount: number;
    totalCount: number;
    lastReloadTime: number;
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
        toast.success(t("sensitiveWords.refreshCacheSuccess", { count }));
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("sensitiveWords.refreshCacheFailed"));
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
          ? t("sensitiveWords.cacheStats", {
              containsCount: stats.containsCount,
              exactCount: stats.exactCount,
              regexCount: stats.regexCount,
            })
          : t("sensitiveWords.refreshCache")
      }
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      {t("sensitiveWords.refreshCache")}
      {stats && <span className="ml-2 text-xs text-muted-foreground">({stats.totalCount})</span>}
    </Button>
  );
}
