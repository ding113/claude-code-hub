"use client";

import { ArrowRightLeft, Loader2, Pin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { pinModelPricingProviderAsManual } from "@/actions/model-prices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ModelPrice } from "@/types/model-price";

interface ProviderPricingDialogProps {
  price: ModelPrice;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

function formatScalar(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  if (value < 0.01) return value.toFixed(4);
  if (value < 1) return value.toFixed(3);
  if (value < 100) return value.toFixed(2);
  return value.toFixed(0);
}

function formatTokenPrice(value?: number): string {
  const formatted = formatScalar(typeof value === "number" ? value * 1000000 : undefined);
  return formatted === "-" ? "-" : `$${formatted}/M`;
}

export function ProviderPricingDialog({ price, trigger, onSuccess }: ProviderPricingDialogProps) {
  const t = useTranslations("settings.prices");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pinningKey, setPinningKey] = useState<string | null>(null);

  const pricingEntries = useMemo(() => {
    const pricing = price.priceData.pricing;
    if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
      return [] as Array<[string, Record<string, unknown>]>;
    }

    return Object.entries(pricing)
      .filter((entry): entry is [string, Record<string, unknown>] => {
        return !!entry[1] && typeof entry[1] === "object" && !Array.isArray(entry[1]);
      })
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [price.priceData.pricing]);

  const handlePin = async (pricingProviderKey: string) => {
    setPinningKey(pricingProviderKey);
    try {
      const result = await pinModelPricingProviderAsManual({
        modelName: price.modelName,
        pricingProviderKey,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(t("providerPricing.pinSuccess", { provider: pricingProviderKey }));
      setOpen(false);
      onSuccess?.();
      window.dispatchEvent(new Event("price-data-updated"));
    } catch (error) {
      console.error("pin provider pricing failed", error);
      toast.error(t("providerPricing.pinFailed"));
    } finally {
      setPinningKey(null);
    }
  };

  if (pricingEntries.length === 0) {
    return null;
  }

  const defaultTrigger = (
    <Button variant="ghost" size="sm">
      <ArrowRightLeft className="h-4 w-4 mr-2" />
      {t("actions.comparePricing")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("providerPricing.title", { model: price.modelName })}</DialogTitle>
          <DialogDescription>{t("providerPricing.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {pricingEntries.map(([providerKey, providerPricing]) => {
            const isPinning = pinningKey === providerKey;
            return (
              <div
                key={providerKey}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {providerKey}
                    </Badge>
                    {price.priceData.selected_pricing_provider === providerKey ? (
                      <Badge variant="outline">{t("providerPricing.pinned")}</Badge>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPinning}
                    onClick={() => void handlePin(providerKey)}
                  >
                    {isPinning ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Pin className="h-4 w-4 mr-2" />
                    )}
                    {t("providerPricing.pinAction")}
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">{t("providerPricing.input")}</div>
                    <div className="font-mono">
                      {formatTokenPrice(providerPricing.input_cost_per_token as number | undefined)}
                    </div>
                    {typeof providerPricing.input_cost_per_token_priority === "number" ? (
                      <div className="font-mono text-xs text-orange-600 dark:text-orange-400">
                        {t("providerPricing.priority")}: {formatTokenPrice(
                          providerPricing.input_cost_per_token_priority as number | undefined
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-muted-foreground">{t("providerPricing.output")}</div>
                    <div className="font-mono">
                      {formatTokenPrice(providerPricing.output_cost_per_token as number | undefined)}
                    </div>
                    {typeof providerPricing.output_cost_per_token_priority === "number" ? (
                      <div className="font-mono text-xs text-orange-600 dark:text-orange-400">
                        {t("providerPricing.priority")}: {formatTokenPrice(
                          providerPricing.output_cost_per_token_priority as number | undefined
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-muted-foreground">{t("providerPricing.cacheRead")}</div>
                    <div className="font-mono">
                      {formatTokenPrice(
                        providerPricing.cache_read_input_token_cost as number | undefined
                      )}
                    </div>
                    {typeof providerPricing.cache_read_input_token_cost_priority === "number" ? (
                      <div className="font-mono text-xs text-orange-600 dark:text-orange-400">
                        {t("providerPricing.priority")}: {formatTokenPrice(
                          providerPricing.cache_read_input_token_cost_priority as number | undefined
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tCommon("close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
