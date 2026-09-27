"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isBalanceExpired, isLowBalance, presentBalance } from "./format";
import { BalanceTooltipDetails } from "./provider-balance-badge";
import { useProviderBalance } from "./provider-balance-context";

/**
 * 服务商视图的余额小标签：单行内联，跟随密钥行的高度，不占用额外纵向空间。
 * 接近视口时才发起查询，点击立即向上游重新查询。
 */
export function ProviderBalanceChip({ providerId }: { providerId: number }) {
  const t = useTranslations("settings.providers.balance");
  const { ref, entry, refresh } = useProviderBalance<HTMLSpanElement>(providerId);
  const presentation = presentBalance(entry.snapshot);
  const loading = entry.status === "loading";
  const low = isLowBalance(entry.snapshot);
  const expired = isBalanceExpired(entry.snapshot, Date.now());

  const body = (() => {
    if (entry.status !== "ready" && !entry.snapshot) {
      return <Skeleton className="h-3.5 w-12" />;
    }

    if (presentation.kind === "amount") {
      return (
        <span
          className={cn(
            "tabular-nums",
            loading && "opacity-60",
            low && "text-amber-600 dark:text-amber-500",
            expired && "text-destructive"
          )}
        >
          {presentation.text}
        </span>
      );
    }

    if (presentation.kind === "unlimited") return <span>{t("unlimitedShort")}</span>;
    if (presentation.kind === "error") {
      return <span className="text-muted-foreground/70">{t("errorShort")}</span>;
    }

    return <span className="text-muted-foreground/60">—</span>;
  })();

  return (
    <span ref={ref} className="inline-flex">
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              refresh().catch(() => toast.error(t("refreshFailed")));
            }}
            disabled={loading}
            aria-label={t("refreshAria")}
            className="group/balance inline-flex items-center gap-1 rounded px-1 text-[10px] font-mono text-muted-foreground hover:bg-muted/60 disabled:cursor-default"
          >
            {body}
            <RefreshCw
              className={cn(
                "h-2.5 w-2.5 opacity-0 transition-opacity group-hover/balance:opacity-100",
                loading && "animate-spin opacity-100"
              )}
              aria-hidden="true"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {entry.snapshot ? (
            <BalanceTooltipDetails snapshot={entry.snapshot} />
          ) : (
            <span className="text-xs">{t("loading")}</span>
          )}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
