"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

interface PriorityEditPopoverProps {
  globalPriority: number;
  groupPriorities: Record<string, number> | null;
  groups: string[];
  activeGroupFilter: string | null;
  disabled?: boolean;
  onSave: (
    globalPriority: number,
    groupPriorities: Record<string, number> | null
  ) => Promise<boolean>;
  validator: (value: string) => string | null;
}

export function PriorityEditPopover({
  globalPriority,
  groupPriorities,
  groups,
  activeGroupFilter,
  disabled = false,
  onSave,
  validator,
}: PriorityEditPopoverProps) {
  const t = useTranslations("settings.providers.inlineEdit");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [globalDraft, setGlobalDraft] = useState(() => globalPriority.toString());
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});

  const globalInputRef = useRef<HTMLInputElement>(null);

  // Compute display value and whether it's a group override
  const effectivePriority =
    activeGroupFilter && groupPriorities?.[activeGroupFilter] != null
      ? groupPriorities[activeGroupFilter]
      : globalPriority;
  const isGroupOverride = activeGroupFilter != null && groupPriorities?.[activeGroupFilter] != null;

  // Validation for global draft
  const globalError = validator(globalDraft.trim());

  // Validation for group drafts
  const groupErrors: Record<string, string | null> = {};
  for (const g of groups) {
    const draft = groupDrafts[g] ?? "";
    if (draft.trim() === "") {
      groupErrors[g] = null; // empty means use global
    } else {
      groupErrors[g] = validator(draft.trim());
    }
  }

  const hasAnyError = globalError != null || Object.values(groupErrors).some((e) => e != null);

  const canSave = !disabled && !saving && !hasAnyError && globalDraft.trim() !== "";

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      globalInputRef.current?.focus();
      globalInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const resetDrafts = () => {
    setGlobalDraft(globalPriority.toString());
    const drafts: Record<string, string> = {};
    for (const g of groups) {
      drafts[g] = groupPriorities?.[g] != null ? groupPriorities[g].toString() : "";
    }
    setGroupDrafts(drafts);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;
    if (nextOpen) {
      resetDrafts();
    } else {
      setSaving(false);
    }
    setOpen(nextOpen);
  };

  const handleCancel = () => {
    resetDrafts();
    setOpen(false);
  };

  const handleSave = async () => {
    if (!canSave) return;

    const parsedGlobal = Number(globalDraft.trim());
    if (!Number.isFinite(parsedGlobal) || !Number.isInteger(parsedGlobal) || parsedGlobal < 0)
      return;

    const mergedGroupPriorities: Record<string, number> = { ...(groupPriorities ?? {}) };
    for (const g of groups) {
      const draft = (groupDrafts[g] ?? "").trim();
      if (draft === "") {
        delete mergedGroupPriorities[g];
        continue;
      }
      const val = Number(draft);
      if (Number.isFinite(val) && Number.isInteger(val) && val >= 0) {
        mergedGroupPriorities[g] = val;
      }
    }
    const hasGroupOverrides = Object.keys(mergedGroupPriorities).length > 0;

    setSaving(true);
    try {
      const ok = await onSave(parsedGlobal, hasGroupOverrides ? mergedGroupPriorities : null);
      if (ok) {
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleGroupDraftChange = (group: string, value: string) => {
    setGroupDrafts((prev) => ({ ...prev, [group]: value }));
  };

  const triggerButton = (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 tabular-nums font-medium underline-offset-4 rounded-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        disabled ? "cursor-default text-muted-foreground" : "cursor-pointer hover:underline"
      )}
      onPointerDown={stopPropagation}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDesktop) handleOpenChange(true);
      }}
    >
      {effectivePriority}
      {isGroupOverride && activeGroupFilter && (
        <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight font-normal">
          {activeGroupFilter}
        </Badge>
      )}
    </button>
  );

  const priorityFormFields = (
    <>
      {/* Global priority */}
      <div className="grid gap-1.5">
        <div className="text-xs font-medium">{t("globalPriority")}</div>
        <Input
          ref={globalInputRef}
          value={globalDraft}
          onChange={(e) => setGlobalDraft(e.target.value)}
          disabled={disabled || saving}
          className="tabular-nums"
          aria-label={t("globalPriority")}
          aria-invalid={globalError != null}
          type="number"
          inputMode="decimal"
          step="1"
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              handleCancel();
            }
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
        {globalError && <div className="text-xs text-destructive">{globalError}</div>}
      </div>

      {/* Per-group priorities */}
      {groups.length > 0 && (
        <div className="grid gap-1.5">
          <div className="text-xs font-medium">{t("groupPriorityLabel")}</div>
          {groups.map((group) => (
            <div key={group} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground min-w-[60px] truncate" title={group}>
                {group}
              </span>
              <Input
                value={groupDrafts[group] ?? ""}
                onChange={(e) => handleGroupDraftChange(group, e.target.value)}
                disabled={disabled || saving}
                placeholder={t("groupPriorityPlaceholder")}
                className="tabular-nums"
                aria-label={`${t("groupPriorityLabel")} - ${group}`}
                aria-invalid={groupErrors[group] != null}
                type="number"
                inputMode="decimal"
                step="1"
                onPointerDown={stopPropagation}
                onClick={stopPropagation}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleCancel();
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
              />
              {groupErrors[group] && (
                <div className="text-xs text-destructive">{groupErrors[group]}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );

  const actionButtons = (
    <div className="flex items-center justify-end gap-2 pt-1">
      <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={saving}>
        {t("cancel")}
      </Button>
      <Button type="button" size="sm" onClick={handleSave} disabled={!canSave}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("save")}
      </Button>
    </div>
  );

  if (!isDesktop) {
    return (
      <>
        {triggerButton}
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t("globalPriority")}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">
              <div className="grid gap-3">
                {priorityFormFields}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={saving}
                    className="flex-1"
                    size="lg"
                  >
                    {t("cancel")}
                  </Button>
                  <Button onClick={handleSave} disabled={!canSave} className="flex-1" size="lg">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("save")}
                  </Button>
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>

      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        className="w-auto p-3"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        <div className="grid gap-3">
          {priorityFormFields}
          {actionButtons}
        </div>
      </PopoverContent>
    </Popover>
  );
}
