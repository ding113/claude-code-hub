"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { deleteSingleModelPrice } from "@/actions/model-prices";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DeleteModelDialogProps {
  modelName: string;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

/**
 * 删除模型价格确认对话框
 */
export function DeleteModelDialog({ modelName, trigger, onSuccess }: DeleteModelDialogProps) {
  const t = useTranslations("settings.prices");
  const tCommon = useTranslations("settings.common");

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);

    try {
      const result = await deleteSingleModelPrice(modelName);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(t("toast.deleteSuccess"));
      setOpen(false);
      onSuccess?.();
      window.dispatchEvent(new Event("price-data-updated"));
    } catch (error) {
      console.error("删除失败:", error);
      toast.error(t("toast.deleteFailed"));
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger = (
    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
      <Trash2 className="h-4 w-4 mr-2" />
      {t("actions.delete")}
    </Button>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger || defaultTrigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteModel")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteConfirm", { name: modelName })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tCommon("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
