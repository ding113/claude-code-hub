"use client";

import { addDays } from "date-fns";
import { Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { DatePickerField } from "@/components/form/date-picker-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatDateDistance } from "@/lib/utils/date-format";

export interface QuickRenewKey {
  id: number;
  name: string;
  expiresAt?: string | null;
  status: "enabled" | "disabled";
}

export interface QuickRenewKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyData: QuickRenewKey | null;
  onConfirm: (keyId: number, expiresAt: Date, enableKey?: boolean) => Promise<{ ok: boolean }>;
  translations: {
    title: string;
    description: string;
    currentExpiry: string;
    neverExpires: string;
    expired: string;
    quickExtensionLabel: string;
    quickExtensionHint: string;
    customDateLabel: string;
    customDateHint: string;
    quickOptions: {
      "7days": string;
      "30days": string;
      "90days": string;
      "1year": string;
    };
    customDate: string;
    enableOnRenew: string;
    cancel: string;
    confirm: string;
    confirming: string;
  };
}

export function QuickRenewKeyDialog({
  open,
  onOpenChange,
  keyData,
  onConfirm,
  translations,
}: QuickRenewKeyDialogProps) {
  const locale = useLocale();
  const [customDate, setCustomDate] = useState("");
  const [enableOnRenew, setEnableOnRenew] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Format current expiry for display
  const currentExpiryText = useMemo(() => {
    if (!keyData?.expiresAt) {
      return translations.neverExpires;
    }
    const expiresAt = new Date(keyData.expiresAt);
    // 检查日期是否有效
    if (Number.isNaN(expiresAt.getTime())) {
      return translations.neverExpires;
    }
    const now = new Date();
    if (expiresAt <= now) {
      return translations.expired;
    }
    const relative = formatDateDistance(expiresAt, now, locale, { addSuffix: true });
    const absolute = formatDate(expiresAt, "yyyy-MM-dd", locale);
    return `${relative} (${absolute})`;
  }, [keyData?.expiresAt, locale, translations]);

  // Handle quick selection
  const handleQuickSelect = useCallback(
    async (days: number) => {
      if (!keyData) return;
      setIsSubmitting(true);
      try {
        // Base date: max(current time, original expiry time)
        let baseDate = new Date();
        if (keyData.expiresAt) {
          const expiresAtDate = new Date(keyData.expiresAt);
          // 只有当日期有效且在未来时才使用
          if (!Number.isNaN(expiresAtDate.getTime()) && expiresAtDate > baseDate) {
            baseDate = expiresAtDate;
          }
        }
        const newDate = addDays(baseDate, days);
        // Set to end of day to ensure full day validity
        newDate.setHours(23, 59, 59, 999);
        const shouldEnable =
          !keyData.status || keyData.status === "disabled" ? enableOnRenew : undefined;
        const result = await onConfirm(keyData.id, newDate, shouldEnable);
        if (result.ok) {
          onOpenChange(false);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [keyData, enableOnRenew, onConfirm, onOpenChange]
  );

  // Handle custom date submission
  const handleCustomDateSubmit = useCallback(async () => {
    if (!keyData || !customDate) return;
    setIsSubmitting(true);
    try {
      // 解析为本地时间并设置为当天 23:59:59.999，确保用户选择的那一天整天都有效
      // 注意：new Date("YYYY-MM-DD") 会解析为 UTC 00:00:00，导致时区偏移问题
      const [year, month, day] = customDate.split("-").map(Number);
      const newDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      const shouldEnable =
        !keyData.status || keyData.status === "disabled" ? enableOnRenew : undefined;
      const result = await onConfirm(keyData.id, newDate, shouldEnable);
      if (result.ok) {
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [keyData, customDate, enableOnRenew, onConfirm, onOpenChange]);

  // Reset state when dialog opens/closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setCustomDate("");
        setEnableOnRenew(false);
        setIsSubmitting(false);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  if (!keyData) return null;

  const isDisabled = keyData.status === "disabled";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translations.title}</DialogTitle>
          <DialogDescription>{translations.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current expiry display */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{translations.currentExpiry}</Label>
            <div className="text-sm text-muted-foreground">{currentExpiryText}</div>
          </div>

          {/* Quick options */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{translations.quickExtensionLabel}</Label>
            <div className="text-xs text-muted-foreground mb-2">
              {translations.quickExtensionHint}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect(7)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  translations.quickOptions["7days"]
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect(30)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  translations.quickOptions["30days"]
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect(90)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  translations.quickOptions["90days"]
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect(365)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  translations.quickOptions["1year"]
                )}
              </Button>
            </div>
          </div>

          {/* Custom date picker */}
          <div className="space-y-2">
            <Label htmlFor="custom-date" className="text-sm font-medium">
              {translations.customDateLabel}
            </Label>
            <div className="text-xs text-muted-foreground mb-2">{translations.customDateHint}</div>
            <DatePickerField
              id="custom-date"
              label=""
              value={customDate}
              onChange={setCustomDate}
              disabled={isSubmitting}
              minDate={new Date()}
            />
          </div>

          {/* Enable on renew option (only show if key is disabled) */}
          {isDisabled && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="enable-on-renew" className="text-sm font-medium cursor-pointer">
                {translations.enableOnRenew}
              </Label>
              <Switch
                id="enable-on-renew"
                checked={enableOnRenew}
                onCheckedChange={setEnableOnRenew}
                disabled={isSubmitting}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            {translations.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleCustomDateSubmit}
            disabled={isSubmitting || !customDate}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {translations.confirming}
              </>
            ) : (
              translations.confirm
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
