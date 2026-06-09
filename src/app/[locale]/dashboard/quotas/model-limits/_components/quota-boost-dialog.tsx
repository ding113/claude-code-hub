"use client";

import { Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { QuotaBoostPanel } from "./quota-boost-panel";

interface QuotaBoostDialogProps {
  userId: number;
  userName: string;
  modelGroupId: number;
  modelGroupName: string;
  currencyCode?: CurrencyCode;
  boostCount?: number;
  onChanged?: () => void;
}

export function QuotaBoostDialog({
  userId,
  userName,
  modelGroupId,
  modelGroupName,
  currencyCode = "USD",
  boostCount = 0,
  onChanged,
}: QuotaBoostDialogProps) {
  const t = useTranslations("quota.modelLimits");
  const [open, setOpen] = useState(false);

  const hasBoost = boostCount > 0;
  const triggerTitle = hasBoost
    ? t("boosts.configuredCount", { count: boostCount })
    : t("boosts.panelTitle");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          title={triggerTitle}
          aria-label={triggerTitle}
        >
          <Zap className={cn("h-4 w-4", hasBoost && "text-primary")} />
          {hasBoost && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
              {boostCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{t("boosts.panelTitle")}</DialogTitle>
          <DialogDescription>
            {t("boosts.dialogDescription", { user: userName, group: modelGroupName })}
          </DialogDescription>
        </DialogHeader>
        <QuotaBoostPanel
          userId={userId}
          userName={userName}
          modelGroupId={modelGroupId}
          modelGroupName={modelGroupName}
          currencyCode={currencyCode}
          onChanged={onChanged}
        />
      </DialogContent>
    </Dialog>
  );
}
