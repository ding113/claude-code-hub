"use client";

import { WalletCards } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";

export function BalanceCard({
  balanceUsd,
  currencyCode = "USD",
}: {
  balanceUsd: number | null | undefined;
  currencyCode?: CurrencyCode;
}) {
  const t = useTranslations("myUsage.balance");
  const isUnlimited = balanceUsd == null;
  const isDepleted = !isUnlimited && balanceUsd <= 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            isDepleted ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
          )}
        >
          <WalletCards className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("title")}</p>
          <p
            className={cn(
              "font-mono text-lg font-semibold tabular-nums",
              isDepleted && "text-destructive"
            )}
          >
            {balanceUsd == null ? t("unlimited") : formatCurrency(balanceUsd, currencyCode, 6)}
          </p>
          <p className="text-xs text-muted-foreground">
            {isDepleted ? t("depleted") : t("description")}
          </p>
        </div>
      </div>
    </div>
  );
}
