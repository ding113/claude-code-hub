"use client";

import { Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface ProviderBatchToolbarProps {
  isMultiSelectMode: boolean;
  allSelected: boolean;
  selectedCount: number;
  totalCount: number;
  onEnterMode: () => void;
  onExitMode: () => void;
  onSelectAll: (checked: boolean) => void;
  onInvertSelection: () => void;
  onOpenBatchEdit: () => void;
}

export function ProviderBatchToolbar({
  isMultiSelectMode,
  allSelected,
  selectedCount,
  totalCount,
  onEnterMode,
  onExitMode,
  onSelectAll,
  onInvertSelection,
  onOpenBatchEdit,
}: ProviderBatchToolbarProps) {
  const t = useTranslations("settings.providers.batchEdit");

  if (!isMultiSelectMode) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onEnterMode}
        disabled={totalCount === 0}
      >
        {t("enterMode")}
      </Button>
    );
  }

  const nothingSelected = selectedCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <Checkbox
          aria-label={t("selectAll")}
          checked={allSelected}
          onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
          disabled={totalCount === 0}
        />
        <span className={cn("text-sm text-muted-foreground", nothingSelected && "opacity-70")}>
          {t("selectedCount", { count: selectedCount })}
        </span>
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={onInvertSelection}>
        {t("invertSelection")}
      </Button>

      <Button
        type="button"
        size="sm"
        onClick={onOpenBatchEdit}
        disabled={nothingSelected}
        className="ml-auto sm:ml-0"
      >
        <Pencil className="mr-2 h-4 w-4" />
        {t("editSelected")}
      </Button>

      <Button type="button" size="sm" variant="outline" onClick={onExitMode}>
        <X className="mr-2 h-4 w-4" />
        {t("exitMode")}
      </Button>
    </div>
  );
}
