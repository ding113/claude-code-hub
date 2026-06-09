"use client";

import { ChevronDown, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import type { MyModelGroupQuota } from "@/lib/api-client/v1/actions/my-usage";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { calculateUsagePercent } from "@/lib/utils/limit-helpers";

interface ModelGroupQuotaCardsProps {
  quotas: MyModelGroupQuota[];
  loading?: boolean;
}

export function ModelGroupQuotaCards({ quotas, loading = false }: ModelGroupQuotaCardsProps) {
  const t = useTranslations("myUsage.modelGroupQuota");

  if (loading || quotas.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="space-y-1 px-1">
        <span className="text-sm font-semibold">{t("sectionTitle")}</span>
        <p className="text-xs text-muted-foreground">{t("note")}</p>
      </div>
      {quotas.map((quota) => (
        <ModelGroupCard key={quota.modelGroupId} quota={quota} />
      ))}
    </div>
  );
}

function ModelGroupCard({ quota }: { quota: MyModelGroupQuota }) {
  const t = useTranslations("myUsage.modelGroupQuota");
  const tQuota = useTranslations("myUsage.quota");
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/50",
              isOpen && "border-b"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Layers className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{quota.modelGroupName}</span>
                <span className="text-xs text-muted-foreground">
                  {t("modelsLabel")}: {quota.models.join(", ")}
                </span>
              </div>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-3 p-4">
            {quota.axes.map((axis) => (
              <div key={axis.axis} className="space-y-2 rounded-md border bg-card/50 p-3">
                <div className="text-xs font-semibold text-muted-foreground">
                  {axis.axis === "key" ? tQuota("keyLevel") : tQuota("userLevel")}
                </div>
                {axis.windows.map((w) => (
                  <ModelGroupQuotaRow
                    key={w.window}
                    label={tQuota(w.window)}
                    current={w.current}
                    limit={w.limit}
                    currency={quota.currencyCode}
                  />
                ))}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ModelGroupQuotaRow({
  label,
  current,
  limit,
  currency,
}: {
  label: string;
  current: number;
  limit: number;
  currency: CurrencyCode;
}) {
  const percent = calculateUsagePercent(current, limit);
  const tone = getTone(percent);
  const formatValue = (value: number) => formatCurrency(value, currency);

  const progressClass = cn("h-1.5 flex-1", {
    "bg-destructive/10 [&>div]:bg-destructive": tone === "danger",
    "bg-amber-500/10 [&>div]:bg-amber-500": tone === "warn",
  });

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
        {label}
      </span>
      <Progress
        value={percent ?? 0}
        className={progressClass}
        aria-label={`${label}: ${formatValue(current)} / ${formatValue(limit)}`}
      />
      <span className="shrink-0 text-right font-mono text-xs text-foreground">
        {formatValue(current)}
        <span className="text-muted-foreground">
          {" / "}
          {formatValue(limit)}
        </span>
      </span>
    </div>
  );
}

function getTone(percent: number | null): "default" | "warn" | "danger" {
  if (percent === null) return "default";
  if (percent >= 95) return "danger";
  if (percent >= 80) return "warn";
  return "default";
}
