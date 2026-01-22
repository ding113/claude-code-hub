"use client";

import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type BatchActionMode = "edit" | "delete" | "resetCircuit" | null;

export interface ProviderBatchActionsProps {
  selectedCount: number;
  isVisible: boolean;
  onAction: (mode: BatchActionMode) => void;
  onClose: () => void;
}

export function ProviderBatchActions({
  selectedCount,
  isVisible,
  onAction,
  onClose,
}: ProviderBatchActionsProps) {
  const t = useTranslations("settings.providers.batchEdit");

  if (!isVisible || selectedCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
        "bg-background/95 backdrop-blur border rounded-lg shadow-lg px-4 py-3",
        "transition-all duration-200"
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium tabular-nums">
          {t("selectedCount", { count: selectedCount })}
        </span>

        <Separator orientation="vertical" className="h-6" />

        <Button size="sm" onClick={() => onAction("edit")}>
          <Pencil className="mr-2 h-4 w-4" />
          {t("actions.edit")}
        </Button>

        <Button size="sm" variant="outline" onClick={() => onAction("resetCircuit")}>
          <RotateCcw className="mr-2 h-4 w-4" />
          {t("actions.resetCircuit")}
        </Button>

        <Button size="sm" variant="destructive" onClick={() => onAction("delete")}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t("actions.delete")}
        </Button>

        <Separator orientation="vertical" className="h-6" />

        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("exitMode")}
        </Button>
      </div>
    </div>
  );
}
