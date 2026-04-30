"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRefreshSensitiveWordsCache } from "@/lib/api-client/v1/sensitive-words/hooks";

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
  const { mutateAsync, isPending } = useRefreshSensitiveWordsCache();

  const handleRefresh = async () => {
    try {
      const result = await mutateAsync();
      const totalCount =
        (result as { stats?: { totalCount?: number } } | null | undefined)?.stats?.totalCount ?? 0;
      toast.success(t("sensitiveWords.refreshCacheSuccess", { count: totalCount }));
    } catch {
      // useApiMutation already surfaces toast errors via localizeError
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleRefresh}
      disabled={isPending}
      className="bg-muted/50 border-border hover:bg-white/10 hover:border-white/20"
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
      <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
      {t("sensitiveWords.refreshCache")}
      {stats && <span className="ml-2 text-xs text-muted-foreground">({stats.totalCount})</span>}
    </Button>
  );
}
