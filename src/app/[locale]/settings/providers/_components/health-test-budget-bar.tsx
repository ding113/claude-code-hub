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
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState("");

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

  const mutation = useMutation({
    mutationFn: async (budget: number) => {
      const res = await setHealthTestGlobalDailyBudget(budget);
      if (!res.ok) {
        throw new Error((res as { error?: string }).error || "save failed");
      }
      return res.data;
    },
    onSuccess: async () => {
      toast.success(t("healthTestBudgetSaved"));
      setEditOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["health-test-budget"] });
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err: Error) => {
      toast.error(t("healthTestBudgetSaveFailed"), { description: err.message });
    },
  });

  const todayCost = data?.todayCost ?? 0;
  const budget = data?.budget ?? 1;
  const suspended = data?.isSuspendedToday ?? false;
  const ratio = budget > 0 ? Math.min(1, todayCost / budget) : 0;
  const over = budget > 0 && todayCost >= budget;

  const openEdit = () => {
    setDraft(String(budget));
    setEditOpen(true);
  };

  return (
    <div
      className={cn(
        "rounded-md border border-border/70 bg-muted/20 px-3 py-2 flex flex-col gap-1.5 min-w-[16rem] max-w-md",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
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
                onClick={openEdit}
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
      <p className="text-[10px] text-muted-foreground leading-snug">{t("healthTestBudgetHelp")}</p>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
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
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("healthTestBudgetEditDesc")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                const n = Number.parseFloat(draft);
                if (!Number.isFinite(n) || n < 0.01) {
                  toast.error(t("healthTestBudgetInvalid"));
                  return;
                }
                mutation.mutate(n);
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
