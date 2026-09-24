"use client";

import { RefreshCw, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProviderBalanceControls } from "./provider-balance-context";

/** 列表上方的余额控制条：说明余额来源，并提供一次性刷新全部已加载供应商的入口 */
export function ProviderBalanceToolbar() {
  const t = useTranslations("settings.providers.balance");
  const { isRefreshingAll, refreshAll } = useProviderBalanceControls();

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t("toolbarHint")}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => {
          refreshAll().catch(() => toast.error(t("refreshFailed")));
        }}
        disabled={isRefreshingAll}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isRefreshingAll && "animate-spin")} />
        {isRefreshingAll ? t("refreshingAll") : t("refreshAll")}
      </Button>
    </div>
  );
}
