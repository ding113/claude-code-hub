"use client";

import { Calculator } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CostMultiplierCalculatorProps {
  onApply: (multiplier: number) => void;
  disabled?: boolean;
}

/**
 * A calculator popover that helps users compute the correct cost multiplier
 * based on their actual payment amount and the quota/credit they received.
 *
 * Formula: multiplier = paymentAmount / quotaAmount
 *
 * Example: Paid 142.87 CNY for 210 USD quota -> multiplier = 142.87 / 210 ≈ 0.6803
 */
export function CostMultiplierCalculator({ onApply, disabled }: CostMultiplierCalculatorProps) {
  const t = useTranslations("settings.providers.form.sections.routing.scheduleParams.costMultiplierCalculator");
  const [open, setOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [quotaAmount, setQuotaAmount] = useState("");

  const payment = parseFloat(paymentAmount);
  const quota = parseFloat(quotaAmount);
  const isValid = Number.isFinite(payment) && Number.isFinite(quota) && payment > 0 && quota > 0;
  const calculatedMultiplier = isValid ? Math.round((payment / quota) * 10000) / 10000 : null;

  const handleApply = useCallback(() => {
    if (calculatedMultiplier !== null) {
      onApply(calculatedMultiplier);
      setOpen(false);
      setPaymentAmount("");
      setQuotaAmount("");
    }
  }, [calculatedMultiplier, onApply]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setPaymentAmount("");
      setQuotaAmount("");
    }
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled}
          title={t("trigger")}
        >
          <Calculator className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{t("title")}</h4>
            <p className="text-xs text-muted-foreground">{t("description")}</p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="calc-payment" className="text-xs">
                {t("paymentLabel")}
              </Label>
              <Input
                id="calc-payment"
                type="number"
                min="0"
                step="0.01"
                placeholder={t("paymentPlaceholder")}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="calc-quota" className="text-xs">
                {t("quotaLabel")}
              </Label>
              <Input
                id="calc-quota"
                type="number"
                min="0"
                step="0.01"
                placeholder={t("quotaPlaceholder")}
                value={quotaAmount}
                onChange={(e) => setQuotaAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </div>
          </div>

          {calculatedMultiplier !== null && (
            <div className="rounded-md bg-muted/50 p-3 space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{t("resultLabel")}</span>
                <span className="text-lg font-bold tabular-nums">{calculatedMultiplier}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("formula", { payment: paymentAmount, quota: quotaAmount })}
              </p>
            </div>
          )}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={calculatedMultiplier === null}
            onClick={handleApply}
          >
            {t("apply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
