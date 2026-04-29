"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteKey } from "@/lib/api-client/v1/keys/hooks";

interface DeleteKeyConfirmProps {
  keyData?: {
    id: number;
    name: string;
    maskedKey: string;
  };
}

export function DeleteKeyConfirm({
  keyData,
  onSuccess,
}: DeleteKeyConfirmProps & { onSuccess?: () => void }) {
  const t = useTranslations("dashboard.deleteKeyConfirm");
  const { mutateAsync, isPending } = useDeleteKey(keyData?.id ?? 0);

  const handleConfirm = async () => {
    if (!keyData) return;
    try {
      await mutateAsync();
      onSuccess?.();
    } catch {
      // useApiMutation already surfaces toast errors via localizeError
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>
          {t("description", { name: keyData?.name ?? "", maskedKey: keyData?.maskedKey ?? "" })}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
          {isPending ? t("confirmLoading") : t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
