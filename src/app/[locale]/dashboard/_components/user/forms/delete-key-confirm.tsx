"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { removeKey } from "@/actions/keys";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("dashboard.deleteKeyConfirm");

  const handleConfirm = () => {
    if (!keyData) return;
    startTransition(async () => {
      try {
        const res = await removeKey(keyData.id);
        if (!res.ok) {
          toast.error(res.error || t("errors.deleteFailed"));
          return;
        }
        onSuccess?.();
        router.refresh();
      } catch (error) {
        console.error("删除Key失败:", error);
        toast.error(t("errors.retryError"));
      }
    });
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
