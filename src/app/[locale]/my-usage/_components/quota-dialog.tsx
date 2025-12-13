"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { getMyQuota, type MyUsageQuota } from "@/actions/my-usage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CurrencyCode } from "@/lib/utils";
import { QuotaCards } from "./quota-cards";
import { QuotaCardsSkeleton } from "./quota-cards-skeleton";

interface QuotaDialogProps {
  currencyCode: CurrencyCode;
  keyExpiresAt: Date | null;
  userExpiresAt: Date | null;
}

export function QuotaDialog({ currencyCode, keyExpiresAt, userExpiresAt }: QuotaDialogProps) {
  const t = useTranslations("myUsage.quotaDialog");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<MyUsageQuota | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadQuota = useCallback(
    (force = false) => {
      if (hasLoaded && !force) return;

      setError(null);
      startTransition(async () => {
        const result = await getMyQuota();
        if (result.ok) {
          setQuota(result.data);
          setHasLoaded(true);
          setLastUpdated(new Date());
        } else {
          setError(result.error ?? t("loadFailed"));
        }
      });
    },
    [hasLoaded, t]
  );

  useEffect(() => {
    if (open && !hasLoaded) {
      loadQuota();
    }
  }, [open, hasLoaded, loadQuota]);

  const handleRefresh = () => {
    loadQuota(true);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3">
            <DialogTitle>{t("title")}</DialogTitle>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                {t("lastUpdated", { time: formatTime(lastUpdated) })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-2"
              onClick={handleRefresh}
              disabled={isPending}
              aria-busy={isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>
          </div>
        </DialogHeader>
        <div className="mt-4">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {isPending && !hasLoaded ? (
            <QuotaCardsSkeleton />
          ) : (
            <QuotaCards
              quota={quota}
              loading={isPending}
              currencyCode={currencyCode}
              keyExpiresAt={keyExpiresAt}
              userExpiresAt={userExpiresAt}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
