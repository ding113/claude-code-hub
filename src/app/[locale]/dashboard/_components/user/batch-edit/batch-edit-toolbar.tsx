"use client";

import { Download, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface BatchEditToolbarProps {
  isMultiSelectMode: boolean;
  allSelected: boolean;
  selectedUsersCount: number;
  selectedKeysCount: number;
  totalUsersCount: number;
  onEnterMode: () => void;
  onExitMode: () => void;
  onSelectAll: (checked: boolean) => void;
  onDownloadSelectedKeys: () => void;
  onEditSelected: () => void;
}

export function BatchEditToolbar({
  isMultiSelectMode,
  allSelected,
  selectedUsersCount,
  selectedKeysCount,
  totalUsersCount,
  onEnterMode,
  onExitMode,
  onSelectAll,
  onDownloadSelectedKeys,
  onEditSelected,
}: BatchEditToolbarProps) {
  const t = useTranslations("dashboard.userManagement.batchEdit");

  if (!isMultiSelectMode) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onEnterMode}
        disabled={totalUsersCount === 0}
      >
        {t("enterMode")}
      </Button>
    );
  }

  const nothingSelected = selectedUsersCount === 0 && selectedKeysCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <Checkbox
          aria-label={t("selectAll")}
          checked={allSelected}
          onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
          disabled={totalUsersCount === 0}
        />
        <span className={cn("text-sm text-muted-foreground", nothingSelected && "opacity-70")}>
          {t("selectedCount", { users: selectedUsersCount, keys: selectedKeysCount })}
        </span>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onDownloadSelectedKeys}
        disabled={selectedKeysCount === 0}
      >
        <Download className="mr-2 h-4 w-4" />
        {t("downloadSelected")}
      </Button>

      <Button
        type="button"
        size="sm"
        onClick={onEditSelected}
        disabled={nothingSelected}
      >
        <Pencil className="mr-2 h-4 w-4" />
        {t("editSelected")}
      </Button>

      <Button type="button" size="sm" variant="outline" onClick={onExitMode} className="ml-auto">
        <X className="mr-2 h-4 w-4" />
        {t("exitMode")}
      </Button>
    </div>
  );
}
