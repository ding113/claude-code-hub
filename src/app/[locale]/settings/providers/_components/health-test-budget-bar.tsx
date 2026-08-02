"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getHealthTestBudgetOverview,
  setHealthTestGlobalDailyBudget,
  setHealthTestPerProviderDailyBudget,
} from "@/lib/api-client/v1/actions/providers";
import { cn } from "@/lib/utils";
import { type CurrencyCode, formatCurrency, toDecimal } from "@/lib/utils/currency";

function formatAmount(value: number, currencyCode: CurrencyCode): string {
  const d = toDecimal(value) ?? toDecimal(0)!;
  const abs = d.abs();
  let digits = 2;
  if (abs.gt(0) && abs.lt(0.01)) digits = 4;
  else if (abs.lt(1)) digits = 4;
  return formatCurrency(d, currencyCode, digits);
}

export function HealthTestBudgetBar({
  currencyCode = "USD",
  className,
}: {
  currencyCode?: CurrencyCode;
  className?: string;
}) {
  const t = useTranslations("settings.providers.list");
  const queryClient = useQueryClient();
  const [editGlobalOpen, setEditGlobalOpen] = useState(false);
  const [editPerOpen, setEditPerOpen] = useState(false);
  const [draftGlobal, setDraftGlobal] = useState("");
  const [draftPer, setDraftPer] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["health-test-budget"],
    queryFn: async () => {
      const res = await getHealthTestBudgetOverview();
      if (!res.ok) {
        throw new Error((res as { error?: string }).error || "budget");
      }
      return res.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const globalMutation = useMutation({
    mutationFn: async (budget: number) => {
      const res = await setHealthTestGlobalDailyBudget(budget);
      if (!res.ok) {
        throw new Error((res as { error?: string }).error || "save failed");
      }
      return res.data;
    },
    onSuccess: async () => {
      toast.success(t("healthTestBudgetSaved"));
      setEditGlobalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["health-test-budget"] });
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err: Error) => {
      toast.error(t("healthTestBudgetSaveFailed"), { description: err.message });
    },
  });

  const perMutation = useMutation({
    mutationFn: async (budget: number) => {
      const res = await setHealthTestPerProviderDailyBudget(budget);
      if (!res.ok) {
        throw new Error((res as { error?: string }).error || "save failed");
      }
      return res.data;
    },
    onSuccess: async () => {
      toast.success(t("healthTestPerProviderBudgetSaved"));
      setEditPerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["health-test-budget"] });
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err: Error) => {
      toast.error(t("healthTestPerProviderBudgetSaveFailed"), { description: err.message });
    },
  });

  const todayCost = data?.todayCost ?? 0;
  const budget = data?.budget ?? 1;
  const perProviderBudget = data?.perProviderBudget ?? 0.1;
  const suspended = data?.isSuspendedToday ?? false;
  const ratio = budget > 0 ? Math.min(1, todayCost / budget) : 0;
  const over = budget > 0 && todayCost >= budget;
  const perText =
    perProviderBudget <= 0
      ? t("healthTestProviderBudgetUnlimited")
      : formatAmount(perProviderBudget, currencyCode);

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold tracking-tight text-foreground">
          {t("healthTestBudgetTitle")}
        </span>
        {suspended ? (
          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
            {t("healthTestBudgetSuspendedGlobal")}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <div className="flex items-baseline gap-1 min-w-0 text-sm font-semibold tabular-nums font-mono tracking-tight">
          <span className="truncate">{isLoading ? "…" : formatAmount(todayCost, currencyCode)}</span>
          <span className="text-muted-foreground font-normal shrink-0">/</span>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  setDraftGlobal(String(budget));
                  setEditGlobalOpen(true);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm px-1 -mx-1 py-0.5 shrink-0",
                  "text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "transition-colors"
                )}
                aria-label={t("healthTestBudgetEditHint")}
              >
                <span>{isLoading ? "…" : formatAmount(budget, currencyCode)}</span>
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {t("healthTestBudgetEditHint")}
            </TooltipContent>
          </Tooltip>
        </div>
        <span
          className={cn(
            "text-[11px] tabular-nums font-medium shrink-0",
            over ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
          )}
        >
          {isLoading ? "" : `${(ratio * 100).toFixed(0)}%`}
        </span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            over ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground shrink-0">{t("healthTestPerProviderBudgetLabel")}</span>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                setDraftPer(String(perProviderBudget));
                setEditPerOpen(true);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-mono tabular-nums font-medium",
                "text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "transition-colors"
              )}
              aria-label={t("healthTestPerProviderBudgetEditHint")}
            >
              <span>{isLoading ? "…" : perText}</span>
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {t("healthTestPerProviderBudgetEditHint")}
          </TooltipContent>
        </Tooltip>
      </div>

      <p className="text-[10px] text-muted-foreground leading-snug">{t("healthTestBudgetHelp")}</p>

      <Dialog open={editGlobalOpen} onOpenChange={setEditGlobalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("healthTestBudgetEditTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="health-test-budget-input">{t("healthTestBudgetEditLabel")}</Label>
            <Input
              id="health-test-budget-input"
              type="number"
              min={0.01}
              step={0.1}
              value={draftGlobal}
              onChange={(e) => setDraftGlobal(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("healthTestBudgetEditDesc")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGlobalOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={globalMutation.isPending}
              onClick={() => {
                const n = Number.parseFloat(draftGlobal);
                if (!Number.isFinite(n) || n < 0.01) {
                  toast.error(t("healthTestBudgetInvalid"));
                  return;
                }
                globalMutation.mutate(n);
              }}
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editPerOpen} onOpenChange={setEditPerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("healthTestPerProviderBudgetEditTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="health-test-per-provider-budget-input">
              {t("healthTestPerProviderBudgetEditLabel")}
            </Label>
            <Input
              id="health-test-per-provider-budget-input"
              type="number"
              min={0}
              step={0.01}
              value={draftPer}
              onChange={(e) => setDraftPer(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("healthTestPerProviderBudgetEditDesc")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPerOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={perMutation.isPending}
              onClick={() => {
                const n = Number.parseFloat(draftPer);
                if (!Number.isFinite(n) || n < 0 || (n > 0 && n < 0.01)) {
                  toast.error(t("healthTestPerProviderBudgetInvalid"));
                  return;
                }
                perMutation.mutate(n);
              }}
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
