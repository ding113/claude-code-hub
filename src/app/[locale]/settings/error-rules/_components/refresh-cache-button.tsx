"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRefreshErrorRulesCache } from "@/lib/api-client/v1/error-rules/hooks";
import { cn } from "@/lib/utils";

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
  const { mutateAsync, isPending } = useRefreshErrorRulesCache();

  const handleRefresh = async () => {
    try {
      const result = await mutateAsync();
      const totalCount =
        (result as { stats?: { totalCount?: number } } | null | undefined)?.stats?.totalCount ?? 0;
      toast.success(t("errorRules.refreshCacheSuccess", { count: totalCount }));
    } catch {
      // useApiMutation already surfaces toast errors via localizeError
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleRefresh}
      disabled={isPending}
      className="bg-muted/50 border-border hover:bg-muted hover:border-border"
      title={
        stats
          ? t("errorRules.cacheStats", {
              totalCount: stats.totalCount,
            })
          : t("errorRules.refreshCache")
      }
    >
      <RefreshCw className={cn("mr-2 h-4 w-4", isPending && "animate-spin")} />
      {t("errorRules.refreshCache")}
      {stats && <span className="ml-2 text-xs text-muted-foreground">({stats.totalCount})</span>}
    </Button>
  );
}
