"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProviderBalanceSnapshot } from "@/types/provider-balance";
import type { ProviderBalanceEntryStatus } from "./balance-store";
import { isBalanceExpired, isLowBalance, presentBalance } from "./format";
import { useProviderBalance } from "./provider-balance-context";

/** 提示框里的余额明细，列表视图与服务商视图共用 */
export function BalanceTooltipDetails({ snapshot }: { snapshot: ProviderBalanceSnapshot }) {
  const t = useTranslations("settings.providers.balance");
  const presentation = presentBalance(snapshot);
  const expired = isBalanceExpired(snapshot, Date.now());

  const heading =
    presentation.kind === "error"
      ? t(`errors.${presentation.errorCode ?? "upstream_error"}`)
      : presentation.kind === "unsupported"
        ? t("unsupported")
        : presentation.kind === "unlimited"
          ? t("unlimited")
          : t("title");

  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium">{heading}</div>

      {snapshot.source && <div>{t("source", { source: t(`sources.${snapshot.source}`) })}</div>}

      {snapshot.totalGranted !== null && (
        <div>{t("granted", { amount: snapshot.totalGranted.toFixed(2) })}</div>
      )}
      {snapshot.totalUsed !== null && (
        <div>{t("used", { amount: snapshot.totalUsed.toFixed(2) })}</div>
      )}

      {snapshot.expiresAt && (
        <div className={cn(expired && "text-destructive")}>
          {expired
            ? t("expiredAt", { time: new Date(snapshot.expiresAt).toLocaleString() })
            : t("expiresAt", { time: new Date(snapshot.expiresAt).toLocaleString() })}
        </div>
      )}

      <div>{t("checkedAt", { time: new Date(snapshot.checkedAt).toLocaleString() })}</div>
      <div className="text-muted-foreground">{t("refreshHint")}</div>
    </div>
  );
}

function BalanceValue({
  snapshot,
  status,
}: {
  snapshot: ProviderBalanceSnapshot | null;
  status: ProviderBalanceEntryStatus;
}) {
  const t = useTranslations("settings.providers.balance");
  const presentation = presentBalance(snapshot);
  const low = isLowBalance(snapshot);
  const expired = isBalanceExpired(snapshot, Date.now());

  if (status !== "ready" && !snapshot) {
    return <Skeleton className="h-5 w-14 mx-auto my-0.5" />;
  }

  if (presentation.kind === "amount") {
    return (
      <span
        className={cn(
          "font-semibold text-sm tabular-nums",
          status === "loading" && "opacity-60",
          low && "text-amber-600 dark:text-amber-500",
          expired && "text-destructive"
        )}
      >
        {presentation.text}
      </span>
    );
  }

  if (presentation.kind === "unlimited") {
    return (
      <span className="font-semibold text-sm text-muted-foreground">{t("unlimitedShort")}</span>
    );
  }

  if (presentation.kind === "error") {
    return <span className="text-sm text-muted-foreground/70">{t("errorShort")}</span>;
  }

  return <span className="text-sm text-muted-foreground">{t("unknownShort")}</span>;
}

/**
 * 列表视图的余额徽标：与「今日用量」同规格的小方块。
 * 接近视口时才发起查询，点击立即向上游重新查询。
 */
export function ProviderBalanceBadge({
  providerId,
  className,
}: {
  providerId: number;
  className?: string;
}) {
  const t = useTranslations("settings.providers.balance");
  const { ref, entry, refresh } = useProviderBalance<HTMLDivElement>(providerId);
  const loading = entry.status === "loading";

  const handleRefresh = () => {
    refresh().catch(() => toast.error(t("refreshFailed")));
  };

  return (
    <div ref={ref} className={className}>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleRefresh();
            }}
            disabled={loading}
            aria-label={t("refreshAria")}
            className={cn(
              "w-full min-w-[100px] rounded-md bg-muted/30 px-2.5 py-1.5 text-center",
              "transition-colors hover:bg-muted/60 disabled:cursor-default"
            )}
          >
            <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {t("label")}
              <RefreshCw
                className={cn("h-2.5 w-2.5", loading && "animate-spin")}
                aria-hidden="true"
              />
            </div>
            <BalanceValue snapshot={entry.snapshot} status={entry.status} />
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
    </div>
  );
}
