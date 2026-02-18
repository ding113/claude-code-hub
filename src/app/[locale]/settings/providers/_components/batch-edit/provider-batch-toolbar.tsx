"use client";

import { ChevronDown, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ProviderDisplay, ProviderType } from "@/types/provider";

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
  providers: ProviderDisplay[];
  onSelectByType: (type: ProviderType) => void;
  onSelectByGroup: (group: string) => void;
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
  providers,
  onSelectByType,
  onSelectByGroup,
}: ProviderBatchToolbarProps) {
  const t = useTranslations("settings.providers.batchEdit");

  const uniqueTypes = useMemo(() => {
    const typeMap = new Map<ProviderType, number>();
    for (const p of providers) {
      typeMap.set(p.providerType, (typeMap.get(p.providerType) ?? 0) + 1);
    }
    return Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }, [providers]);

  const uniqueGroups = useMemo(() => {
    const groupMap = new Map<string, number>();
    for (const p of providers) {
      if (p.groupTag) {
        const tags = p.groupTag
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        for (const tag of tags) {
          groupMap.set(tag, (groupMap.get(tag) ?? 0) + 1);
        }
      }
    }
    return Array.from(groupMap.entries())
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [providers]);

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

      {uniqueTypes.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              {t("selectByType")}
              <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {uniqueTypes.map(({ type, count }) => (
              <DropdownMenuItem key={type} data-value={type} onClick={() => onSelectByType(type)}>
                {t("selectByTypeItem", { type, count })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {uniqueGroups.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              {t("selectByGroup")}
              <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {uniqueGroups.map(({ group, count }) => (
              <DropdownMenuItem
                key={group}
                data-value={group}
                onClick={() => onSelectByGroup(group)}
              >
                {t("selectByGroupItem", { group, count })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
