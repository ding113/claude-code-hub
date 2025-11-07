"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { refreshCacheAction } from "@/actions/sensitive-words";
import { toast } from "sonner";

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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      const result = await refreshCacheAction();

      if (result.ok) {
        const count = result.data.stats.totalCount;
        toast.success(`缓存刷新成功，已加载 ${count} 个敏感词`);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("刷新缓存失败");
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
          ? `缓存统计：包含(${stats.containsCount}) 精确(${stats.exactCount}) 正则(${stats.regexCount})`
          : "刷新缓存"
      }
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      刷新缓存
      {stats && <span className="ml-2 text-xs text-muted-foreground">({stats.totalCount})</span>}
    </Button>
  );
}
