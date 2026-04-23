"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getKeyQuotaUsage, type KeyQuotaItem, type KeyQuotaUsageResult } from "@/actions/key-quota";
import { editKey } from "@/actions/keys";
import { QuotaProgress } from "@/components/quota/quota-progress";
import { QuotaQuickEditPopover } from "@/components/quota/quota-quick-edit-popover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type CurrencyCode, formatCurrency } from "@/lib/utils";

export interface KeyQuotaUsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyId: number;
  keyName: string;
  currencyCode?: CurrencyCode;
}

const LIMIT_TYPE_ORDER: KeyQuotaItem["type"][] = [
  "limit5h",
  "limitDaily",
  "limitWeekly",
  "limitMonthly",
  "limitTotal",
  "limitSessions",
];

export function KeyQuotaUsageDialog({
  open,
  onOpenChange,
  keyId,
  keyName,
  currencyCode: propCurrencyCode,
}: KeyQuotaUsageDialogProps) {
  const t = useTranslations("dashboard.userManagement.keyQuotaUsageDialog");
  const tEdit = useTranslations("quota.quickEdit");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<KeyQuotaUsageResult | null>(null);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await getKeyQuotaUsage(keyId);
      if (!res.ok) {
        toast.error(res.error || t("fetchFailed"));
        setError(true);
        return;
      }
      setData(res.data);
    } catch (err) {
      console.error("[KeyQuotaUsageDialog] fetch failed", err);
      toast.error(t("fetchFailed"));
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [keyId, t]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(false);
      return;
    }
    fetchData();
  }, [open, fetchData]);

  const currencyCode = data?.currencyCode ?? propCurrencyCode ?? "USD";

  const formatValue = (type: KeyQuotaItem["type"], value: number) => {
    if (type === "limitSessions") {
      return String(value);
    }
    return formatCurrency(value, currencyCode);
  };

  const formatLimit = (type: KeyQuotaItem["type"], limit: number | null) => {
    if (limit === null || limit === 0) {
      return t("noLimit");
    }
    if (type === "limitSessions") {
      return String(limit);
    }
    return formatCurrency(limit, currencyCode);
  };

  const getLabelKey = (type: KeyQuotaItem["type"]) => {
    const map: Record<KeyQuotaItem["type"], string> = {
      limit5h: "labels.limit5h",
      limitDaily: "labels.limitDaily",
      limitWeekly: "labels.limitWeekly",
      limitMonthly: "labels.limitMonthly",
      limitTotal: "labels.limitTotal",
      limitSessions: "labels.limitSessions",
    };
    return map[type];
  };

  const sortedItems = data?.items.slice().sort((a, b) => {
    return LIMIT_TYPE_ORDER.indexOf(a.type) - LIMIT_TYPE_ORDER.indexOf(b.type);
  });

  const KEY_FIELD_MAP: Record<KeyQuotaItem["type"], string> = {
    limit5h: "limit5hUsd",
    limitDaily: "limitDailyUsd",
    limitWeekly: "limitWeeklyUsd",
    limitMonthly: "limitMonthlyUsd",
    limitTotal: "limitTotalUsd",
    limitSessions: "limitConcurrentSessions",
  };

  const handleSaveLimit = useCallback(
    async (type: KeyQuotaItem["type"], newLimit: number | null) => {
      const field = KEY_FIELD_MAP[type];
      if (!field) return false;
      try {
        const value =
          type === "limitSessions" ? (newLimit == null ? 0 : Math.round(newLimit)) : newLimit;
        const res = await editKey(keyId, {
          name: data?.keyName || keyName,
          [field]: value,
        } as Parameters<typeof editKey>[1]);
        if (!res.ok) {
          toast.error(res.error || tEdit("saveFailed"));
          return false;
        }
        toast.success(tEdit("saveSuccess"));
        await fetchData();
        return true;
      } catch (err) {
        console.error("[KeyQuotaUsageDialog] save failed", err);
        toast.error(tEdit("saveFailed"));
        return false;
      }
    },
    [keyId, keyName, data?.keyName, fetchData, tEdit]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{keyName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div
            className="flex items-center justify-center py-8"
            aria-live="polite"
            aria-busy="true"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <span className="text-sm text-muted-foreground">{t("fetchFailed")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchData}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("retry")}
            </Button>
          </div>
        ) : !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("fetchFailed")}</div>
        ) : (
          <div className="space-y-4 py-2">
            {sortedItems?.map((item) => (
              <div key={item.type} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t(getLabelKey(item.type))}</span>
                  <span className="font-medium tabular-nums">
                    {formatValue(item.type, item.current)} /{" "}
                    <QuotaQuickEditPopover
                      currentLimit={item.limit}
                      label={t(getLabelKey(item.type))}
                      unit={item.type === "limitSessions" ? "integer" : "currency"}
                      currencyCode={currencyCode}
                      onSave={(newLimit) => handleSaveLimit(item.type, newLimit)}
                      allowClear={item.type !== "limitSessions"}
                    >
                      <button
                        type="button"
                        className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm cursor-pointer"
                        aria-label={t(getLabelKey(item.type))}
                      >
                        {formatLimit(item.type, item.limit)}
                      </button>
                    </QuotaQuickEditPopover>
                  </span>
                </div>
                {item.limit !== null && item.limit > 0 && (
                  <QuotaProgress current={item.current} limit={item.limit} />
                )}
                {item.type === "limitDaily" && item.mode && (
                  <div className="text-xs text-muted-foreground">
                    {item.mode === "fixed" ? t("modeFixed") : t("modeRolling")}
                    {item.mode === "fixed" && item.time && ` (${item.time})`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
