"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshKeywordRoutingCacheAction } from "@/lib/api-client/v1/actions/keyword-routing";

interface RefreshCacheButtonProps {
  stats: {
    ruleCount: number;
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
      const result = await refreshKeywordRoutingCacheAction();

      if (result.ok) {
        const count = (result.data as { stats: { ruleCount: number } }).stats.ruleCount;
        toast.success(t("keywordRouting.refreshCacheSuccess", { count }));
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(t("keywordRouting.refreshCacheFailed"));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="bg-muted/50 border-border hover:bg-white/10 hover:border-white/20"
      title={
        stats
          ? t("keywordRouting.cacheStats", { count: stats.ruleCount })
          : t("keywordRouting.refreshCache")
      }
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      {t("keywordRouting.refreshCache")}
      {stats && <span className="ml-2 text-xs text-muted-foreground">({stats.ruleCount})</span>}
    </Button>
  );
}
