"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { KeyDialogUserContext } from "@/types/user";
import { EditKeyForm } from "./forms/edit-key-form";

export interface EditKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyData: {
    id: number;
    name: string;
    expiresAt: string;
    canLoginWebUi?: boolean;
    providerGroup?: string | null;
    cacheTtlPreference?: "inherit" | "5m" | "1h";
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    limitConcurrentSessions?: number;
  };
  user?: KeyDialogUserContext;
  isAdmin?: boolean;
  onSuccess?: () => void;
}

export function EditKeyDialog({
  open,
  onOpenChange,
  keyData,
  user,
  isAdmin,
  onSuccess,
}: EditKeyDialogProps) {
  const t = useTranslations("quota.keys.editKeyForm");

  const handleSuccess = () => {
    onSuccess?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <EditKeyForm keyData={keyData} user={user} isAdmin={isAdmin} onSuccess={handleSuccess} />
      </DialogContent>
    </Dialog>
  );
}
