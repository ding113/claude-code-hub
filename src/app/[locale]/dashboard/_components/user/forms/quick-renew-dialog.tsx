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

export interface QuickRenewUser {
  id: number;
  name: string;
  expiresAt?: Date | null;
  isEnabled: boolean;
}

export interface QuickRenewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: QuickRenewUser | null;
  onConfirm: (userId: number, expiresAt: Date, enableUser?: boolean) => Promise<{ ok: boolean }>;
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

export function QuickRenewDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
  translations,
}: QuickRenewDialogProps) {
  const locale = useLocale();
  const [customDate, setCustomDate] = useState("");
  const [enableOnRenew, setEnableOnRenew] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Format current expiry for display
  const currentExpiryText = useMemo(() => {
    if (!user?.expiresAt) {
      return translations.neverExpires;
    }
    const expiresAt = user.expiresAt instanceof Date ? user.expiresAt : new Date(user.expiresAt);
    const now = new Date();
    if (expiresAt <= now) {
      return translations.expired;
    }
    const relative = formatDateDistance(expiresAt, now, locale, { addSuffix: true });
    const absolute = formatDate(expiresAt, "yyyy-MM-dd", locale);
    return `${relative} (${absolute})`;
  }, [user?.expiresAt, locale, translations]);

  // Handle quick selection
  const handleQuickSelect = useCallback(
    async (days: number) => {
      if (!user) return;
      setIsSubmitting(true);
      try {
        // Base date: max(current time, original expiry time)
        const baseDate =
          user.expiresAt && new Date(user.expiresAt) > new Date()
            ? new Date(user.expiresAt)
            : new Date();
        const newDate = addDays(baseDate, days);
        // Set to end of day
        newDate.setHours(23, 59, 59, 999);
        const result = await onConfirm(
          user.id,
          newDate,
          !user.isEnabled && enableOnRenew ? true : undefined
        );
        if (result.ok) {
          onOpenChange(false);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, enableOnRenew, onConfirm, onOpenChange]
  );

  // Handle custom date confirm
  const handleCustomConfirm = useCallback(async () => {
    if (!user || !customDate) return;
    setIsSubmitting(true);
    try {
      const [year, month, day] = customDate.split("-").map(Number);
      if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
        setIsSubmitting(false);
        return;
      }
      const newDate = new Date(year, month - 1, day);
      newDate.setHours(23, 59, 59, 999);
      const result = await onConfirm(
        user.id,
        newDate,
        !user.isEnabled && enableOnRenew ? true : undefined
      );
      if (result.ok) {
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [user, customDate, enableOnRenew, onConfirm, onOpenChange]);

  // Reset state when dialog closes
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setCustomDate("");
        setEnableOnRenew(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translations.title}</DialogTitle>
          <DialogDescription>
            {translations.description.replace("{userName}", user.name)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current expiry display */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{translations.currentExpiry}</Label>
            <div className="text-sm text-muted-foreground">{currentExpiryText}</div>
          </div>

          {/* Quick select buttons */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{translations.quickExtensionLabel}</Label>
            <div className="text-xs text-muted-foreground mb-2">
              {translations.quickExtensionHint}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Button
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
            <Label htmlFor="quick-renew-date" className="text-sm font-medium">
              {translations.customDateLabel}
            </Label>
            <div className="text-xs text-muted-foreground mb-2">{translations.customDateHint}</div>
            <DatePickerField
              id="quick-renew-date"
              label=""
              value={customDate}
              onChange={setCustomDate}
              minDate={new Date()}
            />
          </div>

          {/* Enable on renew switch (only show if user is disabled) */}
          {!user.isEnabled && (
            <div className="flex items-center space-x-2">
              <Switch
                id="enable-on-renew"
                checked={enableOnRenew}
                onCheckedChange={setEnableOnRenew}
              />
              <Label htmlFor="enable-on-renew" className="text-sm font-normal cursor-pointer">
                {translations.enableOnRenew}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            {translations.cancel}
          </Button>
          <Button onClick={handleCustomConfirm} disabled={!customDate || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
